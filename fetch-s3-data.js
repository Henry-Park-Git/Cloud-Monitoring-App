const AWS = require('aws-sdk');
const fs = require('fs');
const s3 = new AWS.S3();

async function fetchData() {
  const bucketName = 'tapwebstiesurl';
  const key = 'urls.json';

  try {
    const data = await s3.getObject({ Bucket: bucketName, Key: key }).promise();
    const urls = JSON.parse(data.Body.toString('utf-8'));

    // Write to a file or set as environment variable
    fs.writeFileSync('urls.json', JSON.stringify(urls));
    console.log('Data successfully fetched and saved to urls.json');
  } catch (error) {
    console.error('Error fetching data from S3:', error);
  }
}
fetchData();
