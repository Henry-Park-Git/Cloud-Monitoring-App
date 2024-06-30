const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient();

exports.handler = async (event) => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  // Ensure the TABLE_NAME environment variable is set
  if (!process.env.TABLE_NAME) {
    console.error('TABLE_NAME environment variable is not set');
    return;
  }

  // Ensure the event contains SNS records
  if (!event.Records || event.Records.length === 0) {
    console.error('No SNS records found in the event');
    return;
  }

  // Parse the SNS message
  let message;
  try {
    message = JSON.parse(event.Records[0].Sns.Message);
    console.log('Parsed SNS message:', message);
  } catch (error) {
    console.error('Error parsing SNS message:', error);
    return;
  }

  // Prepare DynamoDB put parameters
  const params = {
    TableName: process.env.TABLE_NAME,
    Item: {
      AlarmName: message.AlarmName,
      StateChange: message.NewStateValue,
      Reason: message.NewStateReason,
      Timestamp: message.StateChangeTime,
    },
  };

  // Put the item into DynamoDB
  try {
    const result = await dynamodb.put(params).promise();
    console.log('Alarm data saved successfully', result);
  } catch (error) {
    console.error('Error saving alarm data to DynamoDB:', error);
  }
};