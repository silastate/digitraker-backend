// eslint-disable-next-line strict
const AWS = require('aws-sdk');

AWS.config.update({ region: 'us-east-2' });

const dynamo = new AWS.DynamoDB.DocumentClient({ apiVersion: '2012-08-10' });

exports.lambdaHandler = async (event) => {
  const request = event.body;

  const params = {
    TableName: 'Alarms',
    FilterExpression: 'contains(:txids, #txid) AND alarmId BETWEEN :start AND :stop',
    ExpressionAttributeNames: { '#txid': 'txid' },
    ExpressionAttributeValues: {
      ':txids': request.txids,
      ':start': parseInt(request.time1),
      ':stop': parseInt(request.time2),
    },
  };

  return await dynamo.scan(params).promise();
};
