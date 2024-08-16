const AWS = require('aws-sdk');
const codepipeline = new AWS.CodePipeline();

exports.handler = async (event) => {
    const pipelineName = 'WebCrawlerPipelineStack'; // Replace with your pipeline name

    try {
        const params = {
            name: pipelineName,
        };

        const response = await codepipeline.startPipelineExecution(params).promise();
        console.log(`Pipeline ${pipelineName} started successfully:`, response);

    } catch (error) {
        console.error('Error starting the pipeline:', error);
    }
};
