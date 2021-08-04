// eslint-disable-next-line strict
const AWS = require('aws-sdk');

AWS.config.update({ region: 'us-east-2' });

const dynamo = new AWS.DynamoDB.DocumentClient({ apiVersion: '2012-08-10' });

exports.lambdaHandler = async (event) => {
  const request = JSON.parse(event.body);

  const date1 = new Date(request.time1);
  const date2 = new Date(request.time2);

  console.log(date1, date2);

  const results = {};

  const response = {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'OPTIONS,POST,GET',
    },
    body: JSON.stringify(results),
  };

  return response;
};
