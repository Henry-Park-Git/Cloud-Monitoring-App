const cdk = require('aws-cdk-lib');
// const sns = require('aws-cdk-lib/aws-sns');
// const subs = require('aws-cdk-lib/aws-sns-subscriptions');
// const sqs = require('aws-cdk-lib/aws-sqs');
// const ec2 = require('aws-cdk-lib/aws-ec2');
const synthetics = require('aws-cdk-lib/aws-synthetics');
const s3 = require('aws-cdk-lib/aws-s3');
const { Role, ServicePrincipal, ManagedPolicy, Policy, PolicyStatement, Effect } = require('aws-cdk-lib/aws-iam');

class WebCrawlerStack extends cdk.Stack {
  /**
   * @param {cdk.App} scope
   * @param {string} id
   * @param {cdk.StackProps=} props
   */
  constructor(scope, id, props) {
    super(scope, id, props);

    const bucket = new s3.Bucket(this, 'CanaryArtifactBucket', {
      bucketName: 'canary-artifact-bucket',
    });
    bucket.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // Create an IAM role for the Canary
    const role = new Role(this, 'CanaryRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
    });

    role.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));
    role.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('CloudWatchSyntheticsFullAccess'));

    // Define the canary
    const canary = new synthetics.Canary(this, 'GoogleCanary', {
      canaryName: 'google-crawler',
      schedule: synthetics.Schedule.rate(cdk.Duration.minutes(5)), // Run every 5 minutes
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
              if (response.status() !== 200) {
                  throw 'Failed to load page!';
              }
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
    const inlinePolicy = new Policy(this, 'CanaryCustomPolicy', {
      statements: [
        new PolicyStatement({
          actions: [
            's3:PutObject',
            's3:GetObject',
          ],
          resources: [
            `arn:aws:s3:::${bucket.bucketName}/canary/${this.region}/${canary.canaryName}/*`,
          ],
          effect: Effect.ALLOW,
        }),
        // new PolicyStatement({
        //   actions: [
        //     's3:GetBucketLocation',
        //   ],
        //   resources: [
        //     'arn:aws:s3:::cw-syn-results-654654562060-ap-southeast-2',
        //   ],
        //   effect: Effect.ALLOW,
        // }),
        // new PolicyStatement({
        //   actions: [
        //     'logs:CreateLogStream',
        //     'logs:PutLogEvents',
        //     'logs:CreateLogGroup',
        //   ],
        //   resources: [
        //     'arn:aws:logs:ap-southeast-2:654654562060:log-group:/aws/lambda/cwsyn-testcanary-*',
        //   ],
        //   effect: Effect.ALLOW,
        // }),
        new PolicyStatement({
          actions: [
            's3:ListAllMyBuckets',
            'xray:PutTraceSegments',
          ],
          resources: ['*'],
          effect: Effect.ALLOW,
        }),
        new PolicyStatement({
          actions: ['cloudwatch:PutMetricData'],
          resources: ['*'],
          effect: Effect.ALLOW,
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
  }
}

module.exports = { WebCrawlerStack }