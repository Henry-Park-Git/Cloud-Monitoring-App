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
                MetricName: `${name}_Availability`,
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
                MetricName: `${name}_Latency`,
                Dimensions: [
                    { Name: 'URL', Value: name }
                ],
                Unit: 'Milliseconds',
                Value: latency,
                Timestamp: timestamp
            }
        ],
    };

    try {
        await cloudwatch.send(new PutMetricDataCommand(availabilityParams));
        console.log(`Metric ${name}_Availability with value ${success} pushed to CloudWatch`);
    } catch (err) {
        console.error(`Error pushing metric ${name}_Availability to CloudWatch`, err);
    }

    try {
        await cloudwatch.send(new PutMetricDataCommand(latencyParams));
        console.log(`Metric ${name}_Latency with value ${success} pushed to CloudWatch`);
    } catch (err) {
        console.error(`Error pushing metric ${name}_Latency to CloudWatch`, err);
    }
};

const pageLoadBlueprint = async function (urls) {
    const startCrawlTime = Date.now();
    let success = true;

    for (const [name, url] of Object.entries(urls)) {
        let page = await synthetics.getPage();
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        log.info(`${name} (${url}) page loaded`);
        await synthetics.takeScreenshot(`${name}-loaded`, 'loaded');
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
        log.info(`Page ${url} loaded in ${metrics.latency} milliseconds`);
        log.info(`responseEnd: ${metrics.responseEnd} responseStart: ${metrics.requestStart} `);
        await synthetics.takeScreenshot(`${name}-loaded`, 'Loaded');

        await pushMetrics(name, metrics.latency, response.status() === 200);
    }

    const endCrawlTime = Date.now();
    const timeToProcess = endCrawlTime - startCrawlTime;
    const memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024; // Memory usage in MB
    log.info(`Time to process: ${timeToProcess} ms`);
    log.info(`Memory used: ${memoryUsage} MB`);

    const TimeToProcessParams = {
        Namespace: "CloudWatchSynthetics",
        MetricData: [
            {
                MetricName: "TimeToProcess",
                Dimensions: [
                    {
                        Name: "CanaryName",
                        Value: "GoogleCanary",
                    },
                ],
                Unit: "Milliseconds",
                Value: timeToProcess,
                Timestamp: new Date(),
            }
        ],
    }

    const MemoryUsageParams = {
        Namespace: "CloudWatchSynthetics",
        MetricData: [
            {
                MetricName: "MemoryUsage",
                Dimensions: [
                    {
                        Name: "CanaryName",
                        Value: "GoogleCanary",
                    },
                ],
                Unit: "Megabytes",
                Value: memoryUsage,
                Timestamp: new Date(),
            },
        ],
    };

    try {
        await cloudwatch.send(new PutMetricDataCommand(TimeToProcessParams));
        console.log(`Metrics for TimeToProcess pushed to CloudWatch`);
    } catch (err) {
        console.error("Error pushing TimeToProcess metric to CloudWatch", err);
    }

    try {
        await cloudwatch.send(new PutMetricDataCommand(MemoryUsageParams));
        console.log(`Metrics for MemoryUsage pushed to CloudWatch`);
    } catch (err) {
        console.error("Error pushing MemoryUsage metric to CloudWatch", err);
    }

    return success;
};

exports.handler = async () => {
    const urls = JSON.parse(process.env.URLS);
    return await pageLoadBlueprint(urls);
};