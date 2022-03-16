const AWS = require('aws-sdk');

AWS.config.update({ region: 'us-east-2' });

const dynamo = new AWS.DynamoDB({ apiVersion: '2012-08-10' });

exports.handler = async (event) => {
  let decode = Buffer.from(event.data, 'base64').toString('ascii');
  if (decode == '[]') return JSON.stringify('{}', null, 2);

  if (decode.includes('Infinity')) {
    decode = decode.replace(/Infinity/g, '9999');
  }

  if (decode.includes('Short/Open')) {
    decode = decode.replace(/\"Short\/Open\"/g, -9999);
  }

  const json_decode = JSON.parse(decode);
  const input = json_decode[0];
  let request_data = [];
  let reading_array;

  let pressure = false;

  if ('data' in input.message.payload) {
    reading_array = input.message.payload.data;
  } else if ('channel' in input.message.payload) {
    reading_array = input.message.payload.channel;
    pressure = true;
  }

  let sensor;

  await Promise.all(
    reading_array.map(async (item, index) => {
      const txid = input.txid.concat('_', index.toString());
      let value = item;

      if (txid == '1832402_1') {
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
        sensor = await dynamo.query(params).promise();
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

      // input data message
      const data_message = {
        PutRequest: {
          Item: {
            txid: { S: txid },
            createdAt: { N: new Date(input.timestamp).getTime().toString() },
            value: { N: value.toString() },
          },
        },
      };

      request_data = [data_message, ...request_data];
    })
  );

  const params = {
    RequestItems: {
      Readings: request_data,
    },
  };

  if (request_data.length > 0) {
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
