'use strict';

const AWS = require('aws-sdk');

AWS.config.update({ region: 'us-east-2' });

const dynamo = new AWS.DynamoDB({ apiVersion: '2012-08-10' });

const TXID_WITH_COEF = ['2585623_1'];

exports.handler = async (event) => {
  let decode = Buffer.from(event.data, 'base64').toString('ascii');
  if (decode == '[]') return JSON.stringify('{}', null, 2);

  if (decode.includes('Infinity')) {
    decode = decode.replace(/Infinity/g, '9999');
  }

  if (decode.includes('Short/Open')) {
    decode = decode.replace(/\"Short\/Open\"/g, -9999);
  }

  const jsonDecode = JSON.parse(decode);
  const input = jsonDecode[0];
  let requestData = [];
  let readingArray = [];

  let pressure = false;
  if ('data' in input.message.payload) {
    readingArray = input.message.payload.data;
  } else if ('channel' in input.message.payload) {
    readingArray = input.message.payload.channel;
    pressure = true;
  }

  await Promise.all(
    readingArray.map(async (item, index) => {
      const txid = input.txid.concat('_', index.toString());
      let value = item;

      if (txid === '1832402_1') {
        value += -9;
      }

      console.log('txid:', txid, 'value:', value);

      if (pressure) {
        const params = {
          TableName: 'Sensors',
          KeyConditionExpression: 'txid=:txid',
          ExpressionAttributeValues: {
            ':txid': { S: txid },
          },
        };

        const sensor = await dynamo.query(params).promise();

        if (value !== -9999) {
          // equation is WC = 0.015625 * (I - 4) + (lower limit of the sensor)
          // lower limit of the sensor -> positive (0), negative (- 0.125)

          const coef = parseFloat(sensor.Items[0].coef.N);
          value = 0.015625 * (value - 4) + coef; // positive equation
          // value = 0.015625 * (value - 4); // positive equation

          if (!sensor.Items[0].positive.BOOL) {
            // use negative equation
            value -= 0.125;
          }
        }
      }

      const gambiarraMessages = [];
      if (TXID_WITH_COEF.includes(txid)) {
        const gambiarraCoef = await handleGambiarraCoefs(item, input, txid);
        console.log('gambiarraCoef', gambiarraCoef);
        gambiarraMessages.push(gambiarraCoef);
      }

      const dataMessage = [];
      if (!TXID_WITH_COEF.includes(txid)) {
        // input data message
        dataMessage.push({
          PutRequest: {
            Item: {
              txid: { S: txid },
              createdAt: { N: new Date(input.timestamp).getTime().toString() },
              value: { N: value.toString() },
            },
          },
        });
      }

      requestData = [dataMessage, ...requestData, ...gambiarraMessages];
      console.log('requestData', requestData);
    })
  );

  const params = {
    RequestItems: {
      Readings: requestData,
    },
  };

  if (requestData.length > 0) {
    await dynamo
      .batchWriteItem(params, (err, data) => {
        if (err) {
          console.log('Error', err);
        } else {
          console.log('Success', data);
        }
      })
      .promise();
  } else {
    console.log('Adding a new DATA ENTRY FAILED');
  }

  return 0;
};

const handleGambiarraCoefs = async (item, input, txid) => {
  let value = item;
  const params = {
    TableName: 'Sensors',
    KeyConditionExpression: 'txid=:txid',
    ExpressionAttributeValues: {
      ':txid': { S: txid },
    },
  };

  const sensor = await dynamo.query(params).promise();

  console.log('---- handleGambiarraCoefs ----');

  if (value !== -9999) {
    const coef = parseFloat(sensor.Items[0].coef.N);
    value += coef;
    console.log('txid', txid);
    console.log('item', item);
    console.log('coef', coef);
    console.log('value = item + coef', value);
  }

  return {
    PutRequest: {
      Item: {
        txid: { S: txid },
        createdAt: { N: new Date(input.timestamp).getTime().toString() },
        value: { N: value.toString() },
      },
    },
  };
};
