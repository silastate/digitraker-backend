'use strict';
const AWS = require('aws-sdk');

const dynamodb = new AWS.DynamoDB({
  region: 'us-east-2',
  apiVersion: '2012-08-10',
});

exports.handler = async (event, context, callback) => {
  const txid = '3488908_0';

  const params = {
    "TableName": "Readings",
    "Key": {
      "Txid": { "S": "BATATA" },
    }
  };

    const body = await dynamodb.getItem(params, function(err, data) {
        // error
        if (err) {
            console.log(err);
        }
        // successful delete
        else {
            console.log(`Data for txid ${txid} successfully deleted`);
            console.log(data);
        }
    }).promise();

  console.log('body', body);

  const response = {
    statusCode: 200,
    body,
  };

  return response;
};
