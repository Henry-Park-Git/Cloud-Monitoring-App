const { App } = require('aws-cdk-lib');
const { Template } = require('aws-cdk-lib/assertions');
const { WebCrawlerStack } = require('../lib/web-crawler-stack'); 

// Test for s3 bucket
test('S3 Bucket Created', () => {
  const app = new App();
  const stack = new WebCrawlerStack(app, 'TestWebCrawlerStack');

  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::S3::Bucket', {
    BucketName: {
      "Fn::Join": [
        "",
        [
          "canary-artifact-bucket-",
          {
            Ref: "AWS::AccountId"
          },
          "-",
          {
            Ref: "AWS::Region"
          }
        ]
      ]
    }
  });
});

// Test for canary
test('Canary Created', () => {
  const app = new App();
  const stack = new WebCrawlerStack(app, 'TestWebCrawlerStack');

  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::Synthetics::Canary', {
    Schedule: {
      Expression: 'rate(2 minutes)',
    },
    RuntimeVersion: 'syn-nodejs-puppeteer-7.0',
    Name: 'google-crawler',
  });
});
// Test for Dynamo Table
test('DynamoDB Table Created', () => {
  const app = new App();
  const stack = new WebCrawlerStack(app, 'TestWebCrawlerStack');

  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::DynamoDB::Table', {
    TableName: 'AlarmData',
    KeySchema: [
      {
        AttributeName: 'AlarmName',
        KeyType: 'HASH',
      },
    ],
  });
});

// Test for Alarm processing Lambda function
test('Lambda Function Created', () => {
  const app = new App();
  const stack = new WebCrawlerStack(app, 'TestWebCrawlerStack');

  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::Lambda::Function', {
    Runtime: 'nodejs18.x',
  });
});

// Test for SNS topic
test('SNS Topic Created', () => {
  const app = new App();
  const stack = new WebCrawlerStack(app, 'TestWebCrawlerStack');

  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::SNS::Topic', {
    DisplayName: 'Canary Alarm Topic',
  });
});
