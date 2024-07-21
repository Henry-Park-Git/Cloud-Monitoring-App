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

class WebCrawlerStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    const urls = {
      Google: 'https://www.google.com/',
      Youtube: 'https://www.youtube.com/',
      Facebook: 'https://www.facebook.com/',
    };

    // Create S3 bucket for artifacts
    const bucket = new s3.Bucket(this, 'CanaryArtifactBucket', {
      bucketName: `canary-artifact-bucket-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
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

    // Add custom inline policy for Canary
    canaryRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:PutObject', 's3:GetObject'],
      resources: [`arn:aws:s3:::${bucket.bucketName}/canary/${this.region}/${canaryRole.roleName}/*`],
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
      schedule: synthetics.Schedule.rate(Duration.minutes(5)), // Run every 5 minutes
      test: synthetics.Test.custom({
        code: synthetics.Code.fromInline(`
          const synthetics = require('Synthetics');
          const log = require('SyntheticsLogger');
          const { CloudWatchClient, PutMetricDataCommand } = require('@aws-sdk/client-cloudwatch');

          const cloudwatch = new CloudWatchClient({ region: 'ap-southeast-2' });

          const pushMetrics = async (name, latency, success) => {
              const namespace = 'CloudWatchSynthetics';
              const timestamp = new Date();

              // Push availability metric
              const availabilityParams = {
                  Namespace: namespace,
                  MetricData: [
                      {
                          MetricName: \`\${name}_Availability\`,
                          Dimensions: [
                              { Name: 'URL', Value: name }
                          ],
                          Unit: 'Percent',
                          Value: success ? 100 : 0,
                          Timestamp: timestamp
                      }
                  ],
              };

              // Push latency metric
              const latencyParams = {
                  Namespace: namespace,
                  MetricData: [
                      {
                          MetricName: \`\${name}_Latency\`,
                          Dimensions: [
                              { Name: 'URL', Value: name }
                          ],
                          Unit: 'Milliseconds',
                          Value: latency,
                          Timestamp: timestamp
                      }
                  ],
              };

              try 
              {
                  await cloudwatch.send(new PutMetricDataCommand(availabilityParams));
                  console.log(\`Metric \${ name }_Availability with value \${ success } pushed to CloudWatch\`);
              } catch (err) {
                  console.error(\`Error pushing metric \${ name }_Availability to CloudWatch\`, err);
              }

              try {
                  await cloudwatch.send(new PutMetricDataCommand(latencyParams));
                  console.log(\`Metric \${ name }_Latency with value \${ success } pushed to CloudWatch\`);
              } catch (err) {
                  console.error(\`Error pushing metric \${ name }_Latency to CloudWatch\`, err);
              }
          };

          const pageLoadBlueprint = async function (urls) {
              let success = true;

              for (const [name, url] of Object.entries(urls)) {
                  let page = await synthetics.getPage();
                  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                  log.info(\`\${name} (\${url}) page loaded\`);
                  await synthetics.takeScreenshot(\`\${name}-loaded\`, 'loaded');
                  let pageTitle = await page.title();
                  log.info('Page title: ' + pageTitle);

                  if (response.status() !== 200) {
                      throw new Error('Failed to load page: ' + url);
                      success = false;
                  }
                  // Measure latency
                  const metrics = await page.evaluate(() => {
                  const timing = performance.timing;
                  const latency = timing.responseEnd - timing.requestStart;
                  return {
                      latency,
                      responseEnd: timing.responseEnd,
                      requestStart: timing.requestStart
                  };
              });
                  log.info(\`Page \${url} loaded in \${metrics.latency} milliseconds\`);
                  log.info(\`responseEnd: \${metrics.responseEnd} responseStart: \${metrics.requestStart} \`);
                  await synthetics.takeScreenshot(\`\${name}-loaded\`, 'Loaded');
                  
                  await pushMetrics(name, metrics.latency, response.status() === 200);
              }

              return success;
          };

          exports.handler = async () => {
              const urls = JSON.parse(process.env.URLS);
              return await pageLoadBlueprint(urls);
          };
        `),
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

    // Create CloudWatch Alarm for availability and latency for each URL
    Object.keys(urls).forEach((urlName) => {
      // Availability Alarm
      const availabilityMetric = new cloudwatch.Metric({
        namespace: 'CloudWatchSynthetics',
        metricName: `${urlName}_Availability`,
        dimensionsMap: {
          URL: urlName,
        },
        statistic: 'Average',
        period: Duration.minutes(5),
      });

      const availabilityAlarm = new cloudwatch.Alarm(this, `${urlName}AvailabilityAlarm`, {
        metric: availabilityMetric,
        threshold: 30, // 90 : Threshold in percent
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        alarmDescription: `Alarm when ${urlName} availability is less than 90%`,
      });

      availabilityAlarm.addAlarmAction(new cloudwatchActions.SnsAction(topic));

      // Latency Alarm
      const latencyMetric = new cloudwatch.Metric({
        namespace: 'CloudWatchSynthetics',
        metricName: `${urlName}_Latency`,
        dimensionsMap: {
          URL: urlName,
        },
        statistic: 'Average',
        period: Duration.minutes(5),
      });

      const latencyAlarm = new cloudwatch.Alarm(this, `${urlName}LatencyAlarm`, {
        metric: latencyMetric,
        threshold: 1, // 3000 : Example threshold in milliseconds
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        alarmDescription: `Alarm when ${urlName} latency exceeds 3 seconds`,
      });

      latencyAlarm.addAlarmAction(new cloudwatchActions.SnsAction(topic));
    });
  }
}

module.exports = { WebCrawlerStack };
