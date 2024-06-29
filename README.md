# Cloud Monitoring App

This project monitors and notifies the status of web applications using AWS services like CloudWatch, Synthetics, and SNS.

## Description

This project sets up a monitoring system for web applications using AWS CDK. It creates a synthetic canary to periodically check the status of a website and sends notifications if the site is down.

## Features

- Synthetic Canary: Utilizes AWS Synthetics to simulate user interactions and monitor key performance metrics.
- CloudWatch Alarms: Sets up alarms based on availability and latency metrics to proactively detect issues.
- SNS Notifications: Sends alerts through AWS SNS to subscribed endpoints such as email.

## Architecture

The application architecture includes:

- AWS CDK Stack: Defines infrastructure as code using JavaScript for provisioning AWS resources.
- Synthetic Canary: A Lambda function periodically performs checks on predefined URLs.
- CloudWatch Metrics: Captures availability and latency metrics for monitoring purposes.
- SNS Topic: Receives alarms triggered by CloudWatch and sends notifications to subscribed endpoints.

## Prerequisites

Before running this project, ensure you have the following installed and configured:

- Node.js: JavaScript runtime environment.
- AWS CLI: Configured with appropriate IAM permissions.
- AWS CDK: Installed globally on your development machine.

## Getting Started

1. Clone Repository: Clone this repository to your local machine.
   
   ```bash
   git clone <repository-url>
   cd Cloud-Monitoring-App
   ```

2. Install Dependencies: Install project dependencies using npm.

   ```bash
   npm install
   ```

3. Configure AWS CLI: Ensure your AWS CLI is configured with credentials that have permissions to deploy AWS resources.

   ```bash
   aws configure
   ```

4. Deploy Stack: Deploy the CDK stack to your AWS account.

   ```bash
   cdk deploy
   ```

5. Monitor and Manage: Explore the deployed resources in your AWS Management Console. Use `cdk destroy` to remove the stack when no longer needed.

## Adding Alarms

This project includes CloudWatch Alarms to notify you of issues detected by the synthetic canary.

### Canary Failure Alarm

Triggers when the synthetic canary detects a failure.

## How It Works

### Synthetic Canary

Periodically checks the status of configured websites.

### CloudWatch Alarms Overview

The stack sets up two types of CloudWatch Alarms:

Availability Alarm: Monitors the success rate of the canary.

Metric: SuccessPercent
Condition: Triggers when the success percentage is less than 90% over a period of 5 minutes.
Actions: Sends notifications to an SNS topic subscribed via email or other endpoints.
Latency Alarm: Monitors the latency of the canary.

Metric: Duration
Condition: Triggers when the latency exceeds 3 seconds (3000 milliseconds).
Actions: Sends notifications to an SNS topic subscribed via email or other endpoints.

### SNS Topic

Sends notifications to the subscribed email address.

## Contributing

Contributions are welcome! Please fork the repository and submit a pull request with your proposed changes.

## Acknowledgments

- AWS CDK documentation and community for guidance and support.
- Stack Overflow and AWS forums for troubleshooting assistance.

## Explore

This project demonstrates a CDK app with an instance of a stack (`WebCrawlerStack`) that includes the setup of synthetic canaries and associated alarms.

The `cdk.json` file defines configurations for the CDK Toolkit.

## Useful commands

- `npm run test`: Runs Jest unit tests.
- `cdk deploy`: Deploys this stack to your default AWS account/region.
- `cdk diff`: Compares deployed stack with the current state.
- `cdk synth`: Emits the synthesized CloudFormation template.

