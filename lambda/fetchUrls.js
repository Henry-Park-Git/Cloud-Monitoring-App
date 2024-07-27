const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { Readable } = require('stream');

exports.handler = async (event) => {
  const s3Client = new S3Client({ region: process.env.AWS_REGION });
  const params = {
    Bucket: process.env.BUCKET_NAME,
    Key: process.env.URLS_FILE_KEY,
  };
  const command = new GetObjectCommand(params);
  const data = await s3Client.send(command);
  const stream = data.Body;
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  return JSON.parse(buffer.toString('utf-8'));
};
