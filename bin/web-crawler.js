#!/usr/bin/env node
const cdk = require('aws-cdk-lib');
const { WebCrawlerStack } = require('../lib/web-crawler-stack');
const { WebCrawlerPipelineStack } = require('../lib/web-crawler-pipeline-stack');

const app = new cdk.App();
new WebCrawlerStack(app, 'WebCrawlerStack');
new WebCrawlerPipelineStack(app, 'WebCrawlerPipelineStack');
