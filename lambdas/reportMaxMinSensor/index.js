const _ = require('lodash');

const AWS = require('aws-sdk');
AWS.config.update({ region: 'us-east-2' });

const dynamo = new AWS.DynamoDB.DocumentClient({ apiVersion: '2012-08-10' });

exports.handler = async (event) => {
  const response = {
    statusCode: 200,
    body: {},
  };

  try {
    const payload = event?.body?.txid ? event.body : JSON.parse(event.body);

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
      return Math.ceil(reading.createdAt / (24 * 60 * 60 * 1000));
    });

    const wideValues = Object.values(groupedByDay).map((day) => ({
      max: _.maxBy(day, (reading) => reading.value),
      min: _.minBy(day, (reading) => reading.value),
    }));

    response.body = JSON.stringify(wideValues);
  } catch (err) {
    console.log(err);
  }

  return response;
};
