const cdk = require('aws-cdk-lib');
const synthetics = require('aws-cdk-lib/aws-synthetics');
const s3 = require('aws-cdk-lib/aws-s3');
const s3n = require('aws-cdk-lib/aws-s3-notifications');
const targets = require('aws-cdk-lib/aws-events-targets');
const events = require('aws-cdk-lib/aws-events');
const iam = require('aws-cdk-lib/aws-iam');
const cloudwatch = require('aws-cdk-lib/aws-cloudwatch');
const sns = require('aws-cdk-lib/aws-sns');
const snsSubscriptions = require('aws-cdk-lib/aws-sns-subscriptions');
const cloudwatchActions = require('aws-cdk-lib/aws-cloudwatch-actions');
const dynamodb = require('aws-cdk-lib/aws-dynamodb');
const lambda = require('aws-cdk-lib/aws-lambda');
const { Duration } = require('aws-cdk-lib');
const path = require('path');
const fs = require('fs');
const { createMetrics } = require('./metrics');

class WebCrawlerStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    // Configuration is supplied via CDK context or environment variables so that
    // no account-specific values are baked into source. See .env.example / README.
    const urlsBucketName =
      this.node.tryGetContext('urlsBucketName') ||
      process.env.URLS_BUCKET_NAME ||
      'my-monitoring-urls-bucket';
    const alarmEmail =
      this.node.tryGetContext('alarmEmail') ||
      process.env.ALARM_EMAIL ||
      'alerts@example.com';

    const urlbucket = s3.Bucket.fromBucketName(this, 'urlbucket', urlsBucketName);

    // Read URLs from the file created by the fetch-s3-data.js script
    const urls = JSON.parse(fs.readFileSync('urls.json', 'utf-8'));
    

    // Initialize urlNames based on the urls object
    this.urlNames = Object.keys(urls);

  // // Lambda function to trigger CodePipeline
  //   const triggerPipelineFunction = new lambda.Function(this, 'TriggerPipelineFunction', {
  //     runtime: lambda.Runtime.NODEJS_18_X,
  //     handler: 'index.handler',
  //     code: lambda.Code.fromInline(`
  //    const AWS = require('aws-sdk');
  //    const codepipeline = new AWS.CodePipeline();

  //    exports.handler = async (event) => {
  //    const pipelineName = process.env.PIPELINE_NAME; // Use environment variable for pipeline name

  //    try {
  //       const params = {
  //           name: pipelineName,
  //       };

  //       const response = await codepipeline.startPipelineExecution(params).promise();
  //       console.log(\`Pipeline \${pipelineName} started successfully:\`, response);

  //    } catch (error) {
  //       console.error('Error starting the pipeline:', error);
  //    }
  //    };`),
  //     environment: {
  //       PIPELINE_NAME: 'WebCrawlerPipelineStack',
  //     },
  //     timeout: Duration.seconds(30),
  //    });

  //   // Grant Lambda permission to start the pipeline
  //       triggerPipelineFunction.addToRolePolicy(new iam.PolicyStatement({
  //           actions: ['codepipeline:StartPipelineExecution'],
  //           resources: [`arn:aws:codepipeline:${this.region}:${this.account}:WebCrawlerPipelineStack`], 
  //       }));

  //   // Add notification to S3 bucket to trigger the Lambda function on object creation or modification
  //      urlbucket.addEventNotification(s3.EventType.OBJECT_CREATED_PUT, new s3n.LambdaDestination(triggerPipelineFunction));
  //      urlbucket.addEventNotification(s3.EventType.OBJECT_CREATED_POST, new s3n.LambdaDestination(triggerPipelineFunction));
  //      urlbucket.addEventNotification(s3.EventType.OBJECT_CREATED_COPY, new s3n.LambdaDestination(triggerPipelineFunction));
  //      urlbucket.addEventNotification(s3.EventType.OBJECT_REMOVED_DELETE, new s3n.LambdaDestination(triggerPipelineFunction)); 

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

    // Least-privilege access for the Canary to write artifacts (screenshots, logs)
    // to its own bucket only. Scoped to the specific actions the canary needs
    // rather than s3:* on the bucket.
    canaryRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        's3:GetObject',
        's3:PutObject',
        's3:GetBucketLocation',
        's3:ListBucket',
      ],
      resources: [
        bucket.bucketArn, // The bucket itself (for ListBucket / GetBucketLocation)
        `${bucket.bucketArn}/*` // And objects written within it
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
        code: synthetics.Code.fromAsset(path.join(__dirname, '../canary')),
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

    // Subscribe an email endpoint to the topic (configured via context / env var)
    topic.addSubscription(new snsSubscriptions.EmailSubscription(alarmEmail));

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
