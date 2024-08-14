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
- Jest: Testing framwork for Unit tests.

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

4. Perform testing: Perform unit tests on aws resources to make sure they are created with appropriate requirements.
```bash
npm test
```

5. Deploy Stack: Deploy the CDK stack to your AWS account.

   ```bash
   cdk deploy
   ```

6. Monitor and Manage: Explore the deployed resources in your AWS Management Console. Use `cdk destroy` to remove the stack when no longer needed.

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

## DynamoDB Integration:

The DynamoDB table is designed to store alarm data for analysis and troubleshooting. Each alarm is stored as an item in the table, with details about the alarm name, state change, reason, and timestamp.

- Table Name: AlarmData
- Partition Key: AlarmName (String)

Data Stored:
- AlarmName: The name of the alarm.
- StateChange: The new state of the alarm (e.g., ALARM, OK).
- Reason: The reason for the state change.
- Timestamp: The time when the state change occurred.

### Lambda Function:

- Function Name: AlarmProcessorFunction
- Runtime: nodejs20.x
- Handler: alarmProcessor.handler

The Lambda function processes incoming alarm notifications from SNS and stores them in the DynamoDB table. It is triggered whenever an alarm state changes and an SNS notification is published.

Functionality

1.	Receive SNS Notification:
- The Lambda function is subscribed to the SNS topic that receives alarm notifications from CloudWatch.
- When an alarm state changes, an SNS message is sent to the Lambda function.

2.	Parse the SNS Message:
- The Lambda function parses the SNS message to extract alarm details.
- It logs the received event and checks for the presence of SNS records.

3.	Store Alarm Data in DynamoDB:
- The function constructs the item to be stored in DynamoDB using the extracted alarm details.
- It then writes the item to the DynamoDB table.
- Success and error logs are generated based on the outcome of the write operation.


## CI/CD Pipeline
This repository contains the configuration for a CI/CD pipeline for the Cloud Monitoring App, using AWS CDK, CodePipeline, and CodeBuild. The pipeline is set up to automatically deploy the application whenever changes are pushed to the GitHub repository.

### Prerequisites

Before setting up the pipeline, ensure you have the following prerequisites:

- AWS CLI configured with appropriate permissions
- AWS CDK installed
- Node.js and npm installed
- GitHub personal access token stored in AWS Secrets Manager
- An S3 bucket for storing build artifacts

### lib/web-crawler-pipeline-stack.js's Architecture

This file defines the CI/CD pipeline stack. The stack includes the following stages:

1. **Source Stage**: Monitors the GitHub repository for changes.
2. **Build Stage**: Uses AWS CodeBuild to install dependencies and synthesize the CDK stack.
3. **Deploy Stage**: Deploys the synthesized CloudFormation stack using AWS CodePipeline.

### buildspec.yml
This file defines the build specification for AWS CodeBuild. It specifies the commands to install dependencies and synthesize the CDK stack.

### File Structure

The key files related to the CI/CD pipeline are organized as follows:
```
Cloud-Monitoring-App/
├── bin/
│ └── web-crawler.js
├── lib/
│ ├── web-crawler-stack.js
│ └── web-crawler-pipeline-stack.js
├── buildspec.yml
└── package.json
```

### Pipeline Workflow

1. Source Stage:
- Monitors the main branch of the Cloud-Monitoring-App repository on GitHub.
- Uses a GitHub personal access token stored in AWS Secrets Manager (github-token) for authentication.

2. Build Stage:
- Executes the commands defined in buildspec.yml to install dependencies and synthesize the CDK stack.
- Outputs the synthesized CloudFormation templates to the cdk.out directory.

3. Deploy Stage:
- Uses the synthesized CloudFormation template to update the CloudFormation stack.
- Deploys the stack defined in lib/web-crawler-stack.js.


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
- `node fetch-s3-data.js`: To fetch data from s3.
