const AWS = require('aws-sdk');
AWS.config.update({ region: 'us-east-2' });

const dynamo = new AWS.DynamoDB({ apiVersion: '2012-08-10' });

const dataparsersdk = require('./lib')

const TXID_WITH_COEF = [];

exports.handler = async event => {
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
  console.log('INCOMMING MESSAGE', JSON.stringify(input, null, 2));
  //let reading_array;
  let reading_array = [];

  let pressure = false;
  let newPressure = false;
  if ('data' in input.message.payload) {
    reading_array = input.message.payload.data;
  } else if ('channel' in input.message.payload) {
    reading_array = input.message.payload.channel;
    pressure = true;
    newPressure = false;
  }else if ('serialData' in input.message.payload) {
    console.log('input:', input);
    //readingArray = input.message.payload.channel;
    const parsedDataResp = dataparsersdk.parseData(input.message.payload.serialData)
    console.log("parsedDataResp--------> ",parsedDataResp);
    
     console.log("parsedDataResp111--------> ",parsedDataResp);
   reading_array[0] = parsedDataResp.channel1;
    reading_array[1] = parsedDataResp.channel2;
    console.log("readingArray: ", reading_array);
    pressure = true;
    newPressure = true;
  }

  reading_array = await reading_array.map(reading => {
    if (typeof reading === 'number') {
      return reading;
    }
  });

  let sensor = {};
  //heartbeat:number
  //lastHeartbeat:number
  const requests_params = await Promise.all(
    reading_array.map(async (item, index) => {
      const txid = input.txid.concat('_', index.toString());
      let value = item;
      console.log('txid:', txid, 'value:', value);
      let a = 1.46717E-03;
      let B = 2.38452E-04;
      let C = 0.000000100399;
      let K = 273.15;

      let ultraTxids = ['4643665_1','4345080_1','3959378_1','3958810_1','3957966_1','3956362_1','3958769_1','4344126_1'];
     // ultraTxids.includes(txid);
      console.log('ultraTxids contains:', ultraTxids.includes(txid));
     //if (txid === '4643665_1') {
     if(ultraTxids.includes(txid)){
      console.log(txid, 'input:', input.message.payload.data);

      value = (value * 500000)/(500000 - value);
      console.log('Rprobe value:', value);
      
      let b = (B * Math.log(value));
      let c = (C * Math.pow(Math.log(value),3));
      
      console.log("Pre T ----->",((a+b+c)));

      value = ((1/(a+b+c)) - K);
      console.log("Final T ----->",value);
      value = value * 9/5 + 32;
      console.log("Final value ----->",value);

    }
      if (txid === '1832402_1') {
        value += -9;
      }

      if (TXID_WITH_COEF.includes(txid)) {
        const req = {
          TableName: 'Sensors',
          KeyConditionExpression: 'txid=:txid',
          ExpressionAttributeValues: {
            ':txid': { S: txid }
          }
        };
        sensor = await dynamo.query(req).promise();

        const coef = parseFloat(sensor.Items[0].coef.N);
        value += coef; // positive equation
      }

      if (pressure && !newPressure) {
        const req = {
          TableName: 'Sensors',
          KeyConditionExpression: 'txid=:txid',
          ExpressionAttributeValues: {
            ':txid': { S: txid }
          }
        };
        sensor = await dynamo.query(req).promise();

        if (value !== -9999) {
          // equation is WC = 0.015625 * (I - 4) + (lower limit of the sensor)
          // lower limit of the sensor -> positive (0), negative (- 0.125)

          const coef = parseFloat(sensor.Items[0].coef.N);
          value = 0.015625 * (value - 4) + coef; // positive equation
          // value = 0.015625 * (value - 4); // positive equation

          if (!sensor.Items[0].positive.BOOL) {
            // use negative equation
            value = value - 0.125;
          }
        }
        // const coef = sensor.Items[0].coef? sensor.Items[0].coef.N : "0"
        // value += parseFloat(coef)
      }

        console.log('Missing Probe Value ---------------->:', value);
//':h': { N: value.toString() },
      const params = {
        TableName: 'Sensors',
        Key: {
          txid: { S: txid }
        },
        ExpressionAttributeNames: {
          '#hb': 'heartbeat',
          '#lhb': 'lastHeartbeat'
        },
        UpdateExpression: 'set #hb = :h, #lhb = :lh',
        ExpressionAttributeValues: {
          ':h': { N: value ? value.toString() : '99.999' },
          ':lh': { N: new Date(input.timestamp).getTime().toString() }
        },
        ReturnValues: 'ALL_NEW'
      };

      return params;
    })
  );

  if (requests_params.length > 0) {
    const promises = requests_params.map(async params => {
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
