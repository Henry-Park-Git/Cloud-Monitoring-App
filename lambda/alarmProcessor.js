const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient();

exports.handler = async (event) => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  // Ensure the TABLE_NAME environment variable is set
  if (!process.env.TABLE_NAME) {
    console.error('TABLE_NAME environment variable is not set');
    return {
      status: 'Error',
      message: 'TABLE_NAME environment variable is not set',
    };
  } else {
    console.log('TABLE_NAME environment variable is set');
  }

  // Ensure the event contains SNS records
  if (!event.Records || event.Records.length === 0) {
    console.error('No SNS records found in the event');
    return {
      status: 'Error',
      message: 'No SNS records found in the event',
    };
  } else {
    console.log('SNS records found in the event');
  }

  // Parse the SNS message
  let message;
  try {
    message = JSON.parse(event.Records[0].Sns.Message);
    console.log('Parsed SNS message:', message);
  } catch (error) {
    console.error('Error parsing SNS message as JSON:', error);
    // If parsing fails, log the message as a string
    message = event.Records[0].Sns.Message;
    console.log('SNS message is not JSON:', message);
    return {
      status: 'Error',
      message: 'SNS message is not in JSON format',
      originalMessage: message,
      error: error.message,
    };
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
    return {
      status: 'Success',
      message: 'Alarm data saved successfully',
      result: result,
    };
  } catch (error) {
    console.error('Error saving alarm data to DynamoDB:', error);
    return {
      status: 'Error',
      message: 'Error saving alarm data to DynamoDB',
      error: error,
    };
  }
};