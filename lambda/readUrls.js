const AWS = require('aws-sdk');
const s3 = new AWS.S3();

exports.handler = async function(event, context) {
    try {
        // Retrieve the bucket name and file key from environment variables
        const bucketName = process.env.BUCKET_NAME;
        const fileKey = process.env.FILE_KEY;

        // Fetch the URLs JSON file from S3
        const params = {
            Bucket: bucketName,
            Key: fileKey,
        };

        const data = await s3.getObject(params).promise();

        // Parse the JSON data
        const urls = JSON.parse(data.Body.toString());

        // Return the URLs object
        return urls;
    } catch (err) {
        console.error('Error reading URLs from S3:', err);
        throw err;
    }
};
