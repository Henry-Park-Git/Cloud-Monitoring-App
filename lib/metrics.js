const cdk = require('aws-cdk-lib'); // Add this line
const cloudwatch = require('aws-cdk-lib/aws-cloudwatch');

function createMetrics(urlName) {
  // Create the availability and latency metrics
  const availabilityMetric = new cloudwatch.Metric({
    namespace: 'CloudWatchSynthetics',
    metricName: `${urlName}_Availability`,
    dimensionsMap: { URL: urlName },
    period: cdk.Duration.minutes(5), // Reference to cdk.Duration
    statistic: 'Average',
  });

  const latencyMetric = new cloudwatch.Metric({
    namespace: 'CloudWatchSynthetics',
    metricName: `${urlName}_Latency`,
    dimensionsMap: { URL: urlName },
    period: cdk.Duration.minutes(5), // Reference to cdk.Duration
    statistic: 'Average',
  });

  return {
    availabilityMetric,
    latencyMetric,
  };
}

module.exports = { createMetrics };
