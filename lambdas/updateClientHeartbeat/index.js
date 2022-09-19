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
  let reading_array;

  console.log(input);

  if ('data' in input.message.payload) {
    reading_array = input.message.payload.data;
  } else if ('channel' in input.message.payload) {
    reading_array = input.message.payload.channel;
  }

  //heartbeat:number
  //lastHeartbeat:number

  // console.log("CLIENT NAME: ", input["client-id"].split("-")[0]);
  const requests_params = await reading_array.map(() => {
    const params = {
      TableName: 'Gateways',
      Key: {
        gatewayId: { S: input['client-id'].split('-')[0] },
      },
      ExpressionAttributeNames: {
        '#lhb': 'lastHeartbeat',
        '#ts': 'timestamp',
      },
      UpdateExpression: 'set #lhb = :lh, #ts = :ts',
      ExpressionAttributeValues: {
        ':lh': { N: new Date(input.timestamp).getTime().toString() },
        ':ts': { S: input.timestamp },
      },
      ReturnValues: 'ALL_NEW',
    };
    return params;
  });

  console.log(requests_params);

  if (requests_params.length > 0) {
    const promises = requests_params.map(async (params) => {
      console.log('Adding a new DATA ENTRY...');
      // console.log("Writing data: " + JSON.stringify(params, null, 2))
      return dynamo
        .updateItem(params, function (err) {
          if (err) {
            console.log('Error', err);
          }
          // console.log("Table UPDATED with this: " + JSON.stringify(data));
        })
        .promise();
    });
    return await Promise.all(promises);
  } else {
    console.log('Adding a new DATA ENTRY FAILED');
    return 0;
  }
};
