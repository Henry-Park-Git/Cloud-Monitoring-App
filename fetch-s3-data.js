const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const s3 = new S3Client({});

async function fetchData() {
  // Configured via environment variable so no private bucket name is hardcoded.
  const bucketName = process.env.URLS_BUCKET_NAME || 'my-monitoring-urls-bucket';
  const key = process.env.URLS_OBJECT_KEY || 'urls.json';

  try {
    const data = await s3.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
    const urls = JSON.parse(await data.Body.transformToString('utf-8'));

    // Write to a file or set as environment variable
    fs.writeFileSync('urls.json', JSON.stringify(urls));
    console.log('Data successfully fetched and saved to urls.json');
  } catch (error) {
    console.error('Error fetching data from S3:', error);
  }
}
fetchData();
