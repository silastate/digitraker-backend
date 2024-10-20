'use strict';

const AWS = require('aws-sdk');

AWS.config.update({ region: 'us-east-2' });

const dynamo = new AWS.DynamoDB({ apiVersion: '2012-08-10' });

const dataparsersdk = require('./lib')



const TXID_WITH_COEF = [];

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
  
  const gatewayId = input['client-id']?.split('-')?.[0];

// Pass the serialData from payload to parseData funcation as below  to get the parsed data
//const parsedDataResp = dataparsersdk.parseData('2022013DFE87E13E00B52644030008')
//console.log("parsedDataResp--------> ",parsedDataResp);

  let pressure = false;
  let newPressure = false;
 //console.log('INPUT DATA',input.message.payload);
 if ('data' in input.message.payload) {
    readingArray = input.message.payload.data;
  } else if ('channel' in input.message.payload) {
    console.log('input:', input);
    readingArray = input.message.payload.channel;
    pressure = true;
    newPressure = false;
  }else if ('serialData' in input.message.payload) {
    console.log('input:', input);
    //readingArray = input.message.payload.channel;
    const parsedDataResp = dataparsersdk.parseData(input.message.payload.serialData)
    console.log("parsedDataResp--------> ",parsedDataResp);
    
    readingArray[0] = parsedDataResp.channel1;
    readingArray[1] = parsedDataResp.channel2;
    console.log("readingArray: ", readingArray);
    pressure = true;
    newPressure = true;
  }

  await Promise.all(
    readingArray.map(async (item, index) => {
      const txid = input.txid.concat('_', index.toString());
      let value = item;

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


      console.log('txid:', txid, 'value:', value);

      if (pressure && !newPressure) {
        const params = {
          TableName: 'Sensors',
          KeyConditionExpression: 'txid=:txid',
          ExpressionAttributeValues: {
            ':txid': { S: txid },
          },
        };
      console.log('Value ---------------->:', value);

        const sensor = await dynamo.query(params).promise();
      console.log('positive or  negative ---------------->:');

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
        const gambiarraCoef = await handleGambiarraCoefs(item, input, txid, gatewayId);
        gambiarraMessages.push(gambiarraCoef);
      } 
      
      const dataMessage = [];
      if (!TXID_WITH_COEF.includes(txid)) {
        if (value === 'Missing Probe') {
          console.log('Missing Probe Value ---------------->:', value);
          value = 99.9999;
          console.log('Missing Probe Value1 ---------------->:', value);
        }
        // input data message
        dataMessage.push({
          PutRequest: {
            Item: {
              txid: { S: txid },
              createdAt: { N: new Date(input.timestamp).getTime().toString() },
              value: { N: value.toString() },
              gatewayId: { S: gatewayId },
            },
          },
        });
      }
      
      requestData = [...dataMessage, ...requestData, ...gambiarraMessages];
    }),
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

const handleGambiarraCoefs = async (item, input, txid, gatewayId) => {
  
  let value = item;
  const params = {
    TableName: 'Sensors',
    KeyConditionExpression: 'txid=:txid',
    ExpressionAttributeValues: {
      ':txid': { S: txid },
    },
  };

  const sensor = await dynamo.query(params).promise();

  if (value !== -9999) {
    const coef = parseFloat(sensor.Items[0].coef.N);
    value += coef;
  }
  console.log('txid ', txid, 'final value:', value);
  return {
    PutRequest: {
      Item: {
        txid: { S: txid },
        createdAt: { N: new Date(input.timestamp).getTime().toString() },
        value: { N: value.toString() },
        gatewayId: { S: gatewayId },
      },
    },
  };
};
