# Welcome to your CDK JavaScript project

#Cloud Monitoring App
A project to monitor and notify the status of your web applications using AWS services like CloudWatch, Synthetics, and SNS.

#Description
This project sets up a monitoring system for your web applications using AWS CDK. It creates a synthetic canary to periodically check the status of a website and sends notifications if the site is down.

#Features
Synthetic canary using AWS Synthetics
Alarm setup using AWS CloudWatch
Email notifications using AWS SNS


#Prerequisites
Node.js
AWS CLI configured with appropriate permissions
AWS CDK

#Adding Alarms
This project includes CloudWatch Alarms to notify you if the synthetic canary detects an issue with your website. The alarm setup includes:

Canary Failure Alarm: Triggers when the synthetic canary fails.
Notification: Sends an email via SNS when the alarm is triggered.

#How It Works
Synthetic Canary: Periodically checks the status of the website.
CloudWatch Alarm: Monitors the success rate of the canary.
SNS Topic: Sends notifications to the subscribed email address.

You should explore the contents of this project. It demonstrates a CDK app with an instance of a stack (`WebCrawlerStack`)
which contains an Amazon SQS queue that is subscribed to an Amazon SNS topic.

The `cdk.json` file tells the CDK Toolkit how to execute your app. The build step is not required when using JavaScript.

## Useful commands

* `npm run test`         perform the jest unit tests
* `cdk deploy`           deploy this stack to your default AWS account/region
* `cdk diff`             compare deployed stack with current state
* `cdk synth`            emits the synthesized CloudFormation template
