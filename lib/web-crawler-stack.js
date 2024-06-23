const cdk = require('aws-cdk-lib');
// const sqs = require('aws-cdk-lib/aws-sqs');
// const ec2 = require('aws-cdk-lib/aws-ec2');
const synthetics = require('aws-cdk-lib/aws-synthetics');
const s3 = require('aws-cdk-lib/aws-s3');
const iam = require('aws-cdk-lib/aws-iam'); 
const cloudwatch = require('aws-cdk-lib/aws-cloudwatch');
const sns = require('aws-cdk-lib/aws-sns');
const snsSubscriptions = require('aws-cdk-lib/aws-sns-subscriptions');
const cloudwatchActions = require('aws-cdk-lib/aws-cloudwatch-actions');
const { Duration } = require('aws-cdk-lib');

class WebCrawlerStack extends cdk.Stack {
  /**
   * @param {cdk.App} scope
   * @param {string} id
   * @param {cdk.StackProps=} props
   */
  constructor(scope, id, props) {
    super(scope, id, props);

    // Create S3 bucket for artifacts
    const bucket = new s3.Bucket(this, 'CanaryArtifactBucket', {
      bucketName: 'canary-artifact-bucket',
    });
    bucket.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // Create IAM role for the Canary
    const role = new iam.Role(this, 'CanaryRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    

    role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));
    role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchSyntheticsFullAccess'));

    // Define the canary
    const canary = new synthetics.Canary(this, 'GoogleCanary', {
      canaryName: 'google-crawler',
      schedule: synthetics.Schedule.rate(Duration.minutes(5)), // Run every 5 minutes
      test: synthetics.Test.custom({
        code: synthetics.Code.fromInline(`
          var synthetics = require('Synthetics');
          const log = require('SyntheticsLogger');

          const pageLoadBlueprint = async function () {
              const URL = 'https://www.google.com';
              let page = await synthetics.getPage();
              const response = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
              log.info('Google.com page loaded');
              await synthetics.takeScreenshot('loaded', 'loaded');
              let pageTitle = await page.title();
              log.info('Page title: ' + pageTitle);

              // Remove this line to stop the intentional failure
              // throw new Error('Simulated failure');

              if (response.status() !== 200) {
                  throw new Error('Failed to load page!');
              }
              // Measure latency
              const loadTime = response ? response.timing().responseEnd - response.timing().requestStart : 'N/A';
              log.info(\`Page loaded in \${loadTime} milliseconds\`);
              await synthetics.takeScreenshot('loaded', 'Loaded');

              return true;
          };

          exports.handler = async () => {
              return await pageLoadBlueprint();
          };
        `),
        handler: 'index.handler',
      }),
      runtime: synthetics.Runtime.SYNTHETICS_NODEJS_PUPPETEER_7_0,
      artifactsBucketLocation: { bucket: bucket },
      role: role,
    });

    // Define a custom inline policy
    const inlinePolicy = new iam.Policy(this, 'CanaryCustomPolicy', {
      statements: [
        new iam.PolicyStatement({
          actions: [
            's3:PutObject',
            's3:GetObject',
          ],
          resources: [
            `arn:aws:s3:::${bucket.bucketName}/canary/${this.region}/${canary.canaryName}/*`,
          ],
          effect: iam.Effect.ALLOW,
        }),
        
        new iam.PolicyStatement({
          actions: [
            's3:ListAllMyBuckets',
            'xray:PutTraceSegments',
          ],
          resources: ['*'],
          effect: iam.Effect.ALLOW,
        }),
        new iam.PolicyStatement({
          actions: ['cloudwatch:PutMetricData'],
          resources: ['*'],
          effect: iam.Effect.ALLOW,
          conditions: {
            StringEquals: {
              'cloudwatch:namespace': 'CloudWatchSynthetics',
            },
          },
        }),
      ],
    });

    // Attach the inline policy to the role
    role.attachInlinePolicy(inlinePolicy);

    // Create SNS Topic
    const topic = new sns.Topic(this, 'AlarmTopic', {
      displayName: 'Canary Alarm Topic',
    });

    // Subscribe an email endpoint to the topic 
    topic.addSubscription(new snsSubscriptions.EmailSubscription('alerts@example.com'));

    // Create CloudWatch Alarm for availability
    const availabilityMetric = canary.metricSuccessPercent();
    const availabilityAlarm = new cloudwatch.Alarm(this, 'CanaryAvailabilityAlarm', {
      metric: availabilityMetric,
      threshold: 90, // Trigger alarm when success percent is less than 90
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      alarmDescription: 'Alarm when canary availability is less than 90%',
    });

    // Add SNS action to the availability alarm
    availabilityAlarm.addAlarmAction(new cloudwatchActions.SnsAction(topic));

    // Create CloudWatch Alarm for latency
    const latencyMetric = new cloudwatch.Metric({
      namespace: 'CloudWatchSynthetics',
      metricName: 'Duration',
      dimensionsMap: {
        CanaryName: canary.canaryName,
      },
      statistic: 'Average',
      period: Duration.minutes(5), // Must match canary schedule
    });

    const latencyAlarm = new cloudwatch.Alarm(this, 'CanaryLatencyAlarm', {
      metric: latencyMetric,
      threshold: 3000, // Example threshold in milliseconds
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Alarm when canary latency exceeds 3 seconds',
    });

    // Add SNS action to the latency alarm
    latencyAlarm.addAlarmAction(new cloudwatchActions.SnsAction(topic));
  }
}

module.exports = { WebCrawlerStack };
