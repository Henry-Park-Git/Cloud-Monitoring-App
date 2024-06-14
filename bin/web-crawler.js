#!/usr/bin/env node
const cdk = require('aws-cdk-lib');
const { WebCrawlerStack } = require('../lib/web-crawler-stack');

const app = new cdk.App();
new WebCrawlerStack(app, 'WebCrawlerStack');
