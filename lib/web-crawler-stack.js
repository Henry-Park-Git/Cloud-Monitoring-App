const cdk = require('aws-cdk-lib');
const synthetics = require('aws-cdk-lib/aws-synthetics');
const s3 = require('aws-cdk-lib/aws-s3');
const iam = require('aws-cdk-lib/aws-iam');
const cloudwatch = require('aws-cdk-lib/aws-cloudwatch');
const sns = require('aws-cdk-lib/aws-sns');
const snsSubscriptions = require('aws-cdk-lib/aws-sns-subscriptions');
const cloudwatchActions = require('aws-cdk-lib/aws-cloudwatch-actions');
const dynamodb = require('aws-cdk-lib/aws-dynamodb');
const lambda = require('aws-cdk-lib/aws-lambda');
const { Duration } = require('aws-cdk-lib');
const path = require('path');
const { createMetrics } = require('./metrics');

class WebCrawlerStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    const urls = {
      Google: 'https://www.google.com/',
      Youtube: 'https://www.youtube.com/',
      Facebook: 'https://www.facebook.com/',
    };

    // Initialize urlNames based on the urls object
    this.urlNames = Object.keys(urls);

    // Create S3 bucket for artifacts
    const bucket = new s3.Bucket(this, 'CanaryArtifactBucket', {
      bucketName: `canary-artifact-bucket-${this.account}-${this.region}`,
      // removalPolicy: cdk.RemovalPolicy.DESTROY,
      // autoDeleteObjects: true,
    });

    // Create IAM role for the Canary
    const canaryRole = new iam.Role(this, 'CanaryRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    canaryRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
    );
    canaryRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchSyntheticsFullAccess')
    );

    // Add custom inline policy for Canary to allow full access to the S3 bucket
    canaryRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:*'], // Broaden to all S3 actions
      resources: [
        bucket.bucketArn, // Ensuring the role can access the bucket itself
        `${bucket.bucketArn}/*` // And all objects within it
      ],
    }));

    canaryRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:ListAllMyBuckets', 'xray:PutTraceSegments'],
      resources: ['*'],
    }));

    canaryRole.addToPolicy(new iam.PolicyStatement({
      actions: ['cloudwatch:PutMetricData'],
      resources: ['*'],
      conditions: {
        StringEquals: {
          'cloudwatch:namespace': 'CloudWatchSynthetics',
        },
      },
    }));

    // Define the canary
    const canary = new synthetics.Canary(this, 'GoogleCanary', {
      canaryName: 'google-crawler',
      schedule: synthetics.Schedule.rate(Duration.minutes(2)), // Run every 2 minutes
      test: synthetics.Test.custom({
        code: synthetics.Code.fromAsset(path.join(__dirname, '../canary/nodejs/node_modules')),
        handler: 'index.handler',
      }),
      runtime: synthetics.Runtime.SYNTHETICS_NODEJS_PUPPETEER_7_0,
      artifactsBucketLocation: { bucket: bucket },
      role: canaryRole,
      environmentVariables: {
        URLS: JSON.stringify(urls),
      },
    });

    // Create DynamoDB table for storing alarm data
    const table = new dynamodb.Table(this, 'AlarmTable', {
      tableName: 'AlarmData',
      partitionKey: { name: 'AlarmName', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create Lambda function for processing alarm data
    const alarmProcessorFunction = new lambda.Function(this, 'AlarmProcessorFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      handler: 'alarmProcessor.handler',
      environment: {
        TABLE_NAME: table.tableName,
      },
    });

    // Grant the Lambda function permissions to write to DynamoDB table
    table.grantWriteData(alarmProcessorFunction);

    // Additional permissions for Lambda, if needed
    alarmProcessorFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:GetItem'
      ],
      resources: [table.tableArn],
    }));

    // Create SNS Topic
    const topic = new sns.Topic(this, 'AlarmTopic', {
      displayName: 'Canary Alarm Topic',
    });

    // Subscribe an email endpoint to the topic
    topic.addSubscription(new snsSubscriptions.EmailSubscription('preetynagpal871@gmail.com'));

    // Add Lambda subscription to the SNS topic
    topic.addSubscription(new snsSubscriptions.LambdaSubscription(alarmProcessorFunction));

    // Create CloudWatch Alarms using imported metrics
    this.urlNames.forEach(urlName => {
      const { availabilityMetric, latencyMetric } = createMetrics(urlName);

      // Availability Alarm
      const availabilityAlarm = new cloudwatch.Alarm(this, `${urlName}AvailabilityAlarm`, {
        metric: availabilityMetric,
        threshold: 90, // Threshold in percentage
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        alarmDescription: `Availability Alarm for ${urlName}`,
      });

      availabilityAlarm.addAlarmAction(new cloudwatchActions.SnsAction(topic));

      // Latency Alarm
      const latencyAlarm = new cloudwatch.Alarm(this, `${urlName}LatencyAlarm`, {
        metric: latencyMetric,
        threshold: 3000, // Threshold in milliseconds
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        alarmDescription: `Latency Alarm for ${urlName}`,
      });

      latencyAlarm.addAlarmAction(new cloudwatchActions.SnsAction(topic));
    });

    const timeToProcessAlarm = new cloudwatch.Alarm(this, 'TimeToProcessAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'CloudWatchSynthetics',
        metricName: 'TimeToProcess',
        dimensionsMap: {
          CanaryName: 'GoogleCanary',
        },
      }),
      threshold: 10000, // Set your threshold here in milliseconds
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });

    const memoryUsageAlarm = new cloudwatch.Alarm(this, 'MemoryUsageAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'CloudWatchSynthetics',
        metricName: 'MemoryUsage',
        dimensionsMap: {
          CanaryName: 'GoogleCanary',
        },
      }),
      threshold: 100, // Set your threshold here in MB
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });
  }
}

module.exports = { WebCrawlerStack };
