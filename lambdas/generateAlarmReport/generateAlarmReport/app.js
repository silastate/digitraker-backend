// eslint-disable-next-line strict
const AWS = require('aws-sdk');

AWS.config.update({ region: 'us-east-2' });

const dynamo = new AWS.DynamoDB.DocumentClient({ apiVersion: '2012-08-10' });

const HEADERS = {
  headers: {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'OPTIONS,POST,GET',
  },
};

exports.lambdaHandler = async (event) => {
  try {
    const payload = JSON.parse(event.body);

    console.log('Payload', payload);

    const params = {
      TableName: 'Alarms',
      FilterExpression: 'contains(:txids, #txid) AND alarmId BETWEEN :start AND :stop',
      ExpressionAttributeNames: { '#txid': 'txid' },
      ExpressionAttributeValues: {
        ':txids': payload.txids,
        ':start': payload.time1,
        ':stop': payload.time2,
      },
    };

    const results = await dynamo.scan(params).promise();

    const response = {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify(results),
    };

    return response;
  } catch (err) {
    const error = {
      statusCode: 400,
      headers: HEADERS,
      body: JSON.stringify(err),
    };

    return error;
  }
};
