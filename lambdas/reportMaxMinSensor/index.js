const _ = require('lodash');

const AWS = require('aws-sdk');
AWS.config.update({ region: 'us-east-2' });

const dynamo = new AWS.DynamoDB.DocumentClient({ apiVersion: '2012-08-10' });

exports.handler = async (event) => {
  let response = {};

  try {
    console.log('event', event);
    console.log('Testing ..');

    const payload = event?.txid ? event : JSON.parse(event);

    const query = {
      TableName: 'Readings',
      KeyConditionExpression:
        'txid = :data AND createdAt BETWEEN :start AND :stop',
      ExpressionAttributeValues: {
        ':data': payload.txid,
        ':start': parseInt(payload.start, 10),
        ':stop': parseInt(payload.stop, 10),
      },
    };

    const readings = await dynamo.query(query).promise();

    const groupedByDay = _.groupBy(readings.Items, (reading) => {
      return new Date(reading.createdAt)
        .toLocaleString('en-US', { timeZone: 'EST' })
        .substring(0, 9);
    });

    const wideValues = Object.values(groupedByDay).map((day) => ({
      max: _.maxBy(day, (reading) => reading.value),
      min: _.minBy(day, (reading) => reading.value),
    }));

    response = wideValues;
  } catch (err) {
    console.log(err);
  }

  return response;
};
