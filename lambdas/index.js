'use strict';

const AWS = require('aws-sdk');

AWS.config.update({ region: 'us-east-2' });

const dynamo = new AWS.DynamoDB({ apiVersion: '2012-08-10' });

const cleanExtraAlarms = (alarmsOn) => {
  const allAlarmTypes = ['outRange', 'tamper', 'lowBattery', 'timeout'];
  const alarmsToKeep = [];
  const alarmsToDelete = [];

  const allExtraDeleteRequest = allAlarmTypes.forEach((alarmType) => {
    const alarmsOnOfAlarmType = alarmsOn.filter((a) => a.alarmType.S === alarmType);
    if (alarmsOnOfAlarmType.length > 1) {
      // keep the oldest one
      // add all others to the delete list
      alarmsOnOfAlarmType.sort((a, b) => (parseInt(a.alarmId.N, 10) > parseInt(b.alarmId.N, 10) ? 1 : -1));

      const extraAlarmsToDelete = alarmsOnOfAlarmType.slice(1);
      alarmsToKeep.push(alarmsOnOfAlarmType[0]);
      const extraAlarmsDeleteRequest = extraAlarmsToDelete
        .map((extraAlarm) => ({
          DeleteRequest: {
            Key: {
              txid: { S: extraAlarm.txid.S },
              alarmId: { N: extraAlarm.alarmId.N },
            },
          },
        }))
        .filter((notUndefined) => notUndefined !== undefined);
      alarmsToDelete.push(extraAlarmsDeleteRequest);
    } else if (alarmsOnOfAlarmType.length === 1) {
      alarmsToKeep.push(alarmsOnOfAlarmType[0]);
    }
  });

  return {
    alarmsToKeep,
    alarmsToDelete: alarmsToDelete.flat(),
  };
};

exports.handler = async (event) => {
  let decode = Buffer.from(event.data, 'base64').toString('ascii');
  if (decode === '[]') return JSON.stringify('{}', null, 2);

  if (decode.includes('Infinity')) {
    decode = decode.replace(/Infinity/g, '9999');
  }

  if (decode.includes('Short/Open')) {
    decode = decode.replace(/\"Short\/Open\"/g, -9999);
  }

  const jsonDecode = JSON.parse(decode);
  const input = jsonDecode[0];

  console.log('[######### INPUT ##########]', JSON.stringify(input, null, 2));

  let readingArray;
  let pressure = false;

  if ('data' in input.message.payload) {
    readingArray = input.message.payload.data;
  } else if ('channel' in input.message.payload) {
    readingArray = input.message.payload.channel;
    pressure = true;
  }

  // console.log(JSON.stringify(input, null, 2))

  await Promise.all(
    readingArray.map(async (item, index) => {
      const txid = input.txid.concat('_', index.toString());
      let alarmMessages = [];
      let deleteMessages = [];

      const infoQueryParams = {
        TableName: 'Sensors',
        KeyConditionExpression: 'txid=:txid',
        ExpressionAttributeValues: {
          ':txid': { S: txid },
        },
      };

      // fetch info for this txid check range and set alarm
      const txidInfo = await dynamo.query(infoQueryParams).promise();

      if (txidInfo.Items[0].deleted === undefined) {
        console.log('SENSOR INFO', txidInfo.Items[0]);

        console.log(`${txid} doesnt exist in Sensors`);
        return;
      }

      const txidAlarmParams = {
        TableName: 'Alarms',
        KeyConditionExpression: 'txid=:txid',
        FilterExpression: 'alarmOn = :o',
        ExpressionAttributeValues: {
          ':txid': { S: txid },
          ':o': { BOOL: true },
        },
      };

      const txidAlarms = await dynamo.query(txidAlarmParams).promise();

      const cleanedAlarmMessages = await cleanExtraAlarms(txidAlarms.Items);

      deleteMessages = [...cleanedAlarmMessages.alarmsToDelete, ...deleteMessages];

      const cleanAlarms = cleanedAlarmMessages.alarmsToKeep;

      console.log('cleanAlarmMessages', JSON.stringify(cleanedAlarmMessages, null, 2));

      let outRange = false;
      let battery = false;
      let tamper = false;

      // adjust units for comparison
      const info = txidInfo.Items[0];

      switch (info.unit ? info.unit.S : '') {
        case 'F':
          break;
        case 'C':
          item = ((item - 32) * 5) / 9;
          break;
        case '%':
          break;
        case 'WC':
          if (pressure && item !== -9999) {
            const coef = parseFloat(info.coef.N);
            item = 0.015625 * (item - 4) + coef; // positive equation
            // item = 0.015625 * (item - 4); // positive equation
            if (!info.positive.BOOL) {
              // use negative equation
              item -= 0.125;
            }
          }
          break; // add equation to compute correct wc
        default:
          console.log(`${txid} doesnt have unit configuration`);
      }

      if (txid === '1832402_1') {
        item += -9;
      }

      // const coef = info.coef ? info.coef.N : "0"
      // item += parseFloat(coef)

      // out of range alarm - compare value with ranges
      if (item > parseFloat(info.rangeMax.N) || item < parseFloat(info.rangeMin.N)) {
        // console.log("outRange")
        outRange = true;
      }
      // low battery alarm
      if (input.message.payload.status.lowBattery === true) {
        // console.log("BATTERY")
        battery = true;
      }

      // tamper alarm
      if (input.message.payload.status.tamper === true) {
        // console.log("TAMPER")
        tamper = true;
      }

      const alarmMessage = {
        PutRequest: {
          Item: {
            txid: { S: txid },
            createdAt: { N: new Date(input.timestamp).getTime().toString() },
            closedAt: { N: '-1' },
            closedBy: { S: '' },
            message: { S: '' },
            alarmOn: { BOOL: true },
            alarmType: { S: '' },
            alarmId: { N: '' },
            escalation: { N: '0' },
            lastEscalation: {
              N: new Date(input.timestamp).getTime().toString(),
            },
          },
        },
      };

      // console.log(txidAlarms)

      let containsOutRange = false;
      let containsTamper = false;
      let containsBattery = false;
      let containsTimeout = false;
      let outRangeHasEscalated = false;
      let batteryHasEscalated = false;
      let tamperHasEscalated = false;
      let timeoutHasEscalated = false;

      if (txidAlarms.Count !== 0) {
        containsOutRange = cleanAlarms.filter((a) => a.alarmType.S === 'outRange').length > 0;
        containsTamper = cleanAlarms.filter((a) => a.alarmType.S === 'tamper').length > 0;
        containsBattery = cleanAlarms.filter((a) => a.alarmType.S === 'lowBattery').length > 0;
        containsTimeout = cleanAlarms.filter((a) => a.alarmType.S === 'timeout').length > 0;

        if (containsOutRange) {
          outRangeHasEscalated = cleanAlarms.filter((a) => a.alarmType.S === 'outRange')[0].escalation.N !== '0';
        }
        if (containsBattery) {
          batteryHasEscalated = cleanAlarms.filter((a) => a.alarmType.S === 'lowBattery')[0].escalation.N !== '0';
        }
        if (containsTamper) {
          tamperHasEscalated = cleanAlarms.filter((a) => a.alarmType.S === 'tamper')[0].escalation.N !== '0';
        }
        if (containsTimeout) {
          timeoutHasEscalated = cleanAlarms.filter((a) => a.alarmType.S === 'timeout')[0].escalation.N !== '0';
        }
      }

      if (outRange && !containsOutRange) {
        // if is outofrange but it wasnt before
        // console.log("create outRange message")
        // create message and put
        const outRangeMessage = { ...alarmMessage };
        outRangeMessage.PutRequest.Item.alarmType.S = 'outRange';
        outRangeMessage.PutRequest.Item.alarmId.N = Date.now().toString();
        alarmMessages = [outRangeMessage, ...alarmMessages];

        // update Sensor with alarmOn and alarmType
        const params = {
          TableName: 'Sensors',
          Key: {
            txid: { S: txid },
          },
          ExpressionAttributeNames: {
            '#alarm': 'alarmOn',
            '#type': 'alarmType',
          },
          UpdateExpression: 'set #alarm = :alarm, #type = :type ',
          ExpressionAttributeValues: {
            ':alarm': { BOOL: true },
            ':type': { S: 'outRange' },
          },
          ReturnValues: 'ALL_NEW',
        };

        dynamo
          .updateItem(params, (err) => {
            if (err) {
              console.log('Error', err);
            }
            // console.log("Table UPDATED with this: " + JSON.stringify(data));
          })
          .promise();
      }
      // if it was outofrange but is no more
      else if (!outRange && containsOutRange && !outRangeHasEscalated) {
        const messageArray = cleanAlarms.filter((a) => a.alarmType.S === 'outRange');

        const deleteOutRangeMessages = messageArray.map((alarm) => ({
          DeleteRequest: {
            Key: {
              txid: { S: txid },
              alarmId: { N: alarm.alarmId.N },
            },
          },
        }));

        deleteMessages = [...deleteOutRangeMessages, ...deleteMessages];

        // clear Sensor.alarmOn to false
        const params = {
          TableName: 'Sensors',
          Key: {
            txid: { S: txid },
          },
          ExpressionAttributeNames: {
            '#alarm': 'alarmOn',
            '#type': 'alarmType',
          },
          UpdateExpression: 'set #alarm = :alarm, #type = :type ',
          ExpressionAttributeValues: {
            ':alarm': { BOOL: false },
            ':type': { S: 'none' },
          },
          ReturnValues: 'ALL_NEW',
        };

        dynamo
          .updateItem(params, (err) => {
            if (err) {
              console.log('Error', err);
            }
            // console.log("Table UPDATED with this: " + JSON.stringify(data));
          })
          .promise();
      }

      if (battery && !containsBattery) {
        // if is lowbattery but it wasnt before
        // create message and put
        const batteryMessage = { ...alarmMessage };
        batteryMessage.PutRequest.Item.alarmType.S = 'lowBattery';
        batteryMessage.PutRequest.Item.alarmId.N = Date.now().toString();
        alarmMessages = [batteryMessage, ...alarmMessages];

        const params = {
          TableName: 'Sensors',
          Key: {
            txid: { S: txid },
          },
          ExpressionAttributeNames: {
            '#alarm': 'alarmOn',
            '#type': 'alarmType',
          },
          UpdateExpression: 'set #alarm = :alarm, #type = :type ',
          ExpressionAttributeValues: {
            ':alarm': { BOOL: true },
            ':type': { S: 'lowBattery' },
          },
          ReturnValues: 'ALL_NEW',
        };

        dynamo
          .updateItem(params, (err) => {
            if (err) {
              console.log('Error', err);
            }
            // console.log("Table UPDATED with this: " + JSON.stringify(data));
          })
          .promise();
      } else if (!battery && containsBattery && !batteryHasEscalated) {
        // if it was low battery but is no more
        // update alarm with:
        // alarmOn=false
        // closedBy=Digitraker
        // closedAt= Date.now().toString()

        const messageArray = cleanAlarms.filter((a) => a.alarmType.S === 'lowBattery');

        const batteryMessage = {
          PutRequest: {
            Item: messageArray[0],
          },
        };

        batteryMessage.PutRequest.Item.closedAt.N = Date.now().toString();
        batteryMessage.PutRequest.Item.closedBy.S = 'Digitraker';
        batteryMessage.PutRequest.Item.message.S = 'Closed Automatically';

        batteryMessage.PutRequest.Item.alarmOn.BOOL = false;

        alarmMessages = [batteryMessage, ...alarmMessages];

        // clear Sensor.alarmOn to false
        const params = {
          TableName: 'Sensors',
          Key: {
            txid: { S: txid },
          },
          ExpressionAttributeNames: {
            '#alarm': 'alarmOn',
            '#type': 'alarmType',
          },
          UpdateExpression: 'set #alarm = :alarm, #type = :type',
          ExpressionAttributeValues: {
            ':alarm': { BOOL: false },
            ':type': { S: 'none' },
          },
          ReturnValues: 'ALL_NEW',
        };

        dynamo
          .updateItem(params, (err) => {
            if (err) {
              console.log('Error', err);
            }
            // console.log("Table UPDATED with this: " + JSON.stringify(data));
          })
          .promise();
      }

      if (tamper && !containsTamper) {
        // if is tampered but it wasnt before
        // create message and put
        const tamperMessage = { ...alarmMessage };
        tamperMessage.PutRequest.Item.alarmType.S = 'tamper';
        tamperMessage.PutRequest.Item.alarmId.N = Date.now().toString();

        alarmMessages = [tamperMessage, ...alarmMessages];

        const params = {
          TableName: 'Sensors',
          Key: {
            txid: { S: txid },
          },
          ExpressionAttributeNames: {
            '#alarm': 'alarmOn',
            '#type': 'alarmType',
          },
          UpdateExpression: 'set #alarm = :alarm, #type = :type ',
          ExpressionAttributeValues: {
            ':alarm': { BOOL: true },
            ':type': { S: 'tamper' },
          },
          ReturnValues: 'ALL_NEW',
        };

        dynamo
          .updateItem(params, (err) => {
            if (err) {
              console.log('Error', err);
            }
            // console.log("Table UPDATED with this: " + JSON.stringify(data));
          })
          .promise();
      } else if (!tamper && containsTamper && !tamperHasEscalated) {
        // if it was tampered but is no more
        // update alarm with:
        // alarmOn=false
        // closedBy=Digitraker
        // closedAt= Date.now().toString()

        const messageArray = cleanAlarms.filter((a) => a.alarmType.S === 'lowBattery');

        const tamperMessage = {
          PutRequest: {
            Item: messageArray[0],
          },
        };

        tamperMessage.PutRequest.Item.closedAt.N = Date.now().toString();
        tamperMessage.PutRequest.Item.closedBy.S = 'Digitraker';
        tamperMessage.PutRequest.Item.message.S = 'Closed Automatically';

        tamperMessage.PutRequest.Item.alarmOn.BOOL = false;

        alarmMessages = [tamperMessage, ...alarmMessages];

        // clear Sensor.alarmOn to false
        const params = {
          TableName: 'Sensors',
          Key: {
            txid: { S: txid },
          },
          ExpressionAttributeNames: {
            '#alarm': 'alarmOn',
            '#type': 'alarmType',
          },
          UpdateExpression: 'set #alarm = :alarm, #type = :type',
          ExpressionAttributeValues: {
            ':alarm': { BOOL: false },
            ':type': { S: 'none' },
          },
          ReturnValues: 'ALL_NEW',
        };

        dynamo
          .updateItem(params, (err) => {
            if (err) {
              console.log('Error', err);
            }
            // console.log("Table UPDATED with this: " + JSON.stringify(data));
          })
          .promise();
      } else if (containsTimeout && !timeoutHasEscalated) {
        // if it has a timeout ON disable it
        console.log('### recovering timeout ###', txid);
        // update alarm with:
        // alarmOn=false
        // closedAt= Date.now().toString()

        const messageArray = cleanAlarms.find((a) => a.alarmType.S === 'timeout');

        const timeoutMessage = {
          PutRequest: {
            Item: messageArray,
          },
        };

        console.log('timeoutMessage', timeoutMessage);

        timeoutMessage.PutRequest.Item.closedAt.N = Date.now().toString();
        timeoutMessage.PutRequest.Item.closedBy.S = 'Digitraker';
        timeoutMessage.PutRequest.Item.message.S = 'Closed Automatically';
        timeoutMessage.PutRequest.Item.alarmOn.BOOL = false;

        alarmMessages = [timeoutMessage, ...alarmMessages];

        // clear Sensor.alarmOn to false
        const params = {
          TableName: 'Sensors',
          Key: {
            txid: { S: txid },
          },
          ExpressionAttributeNames: {
            '#alarm': 'alarmOn',
            '#type': 'alarmType',
          },
          UpdateExpression: 'set #alarm = :alarm, #type = :type',
          ExpressionAttributeValues: {
            ':alarm': { BOOL: false },
            ':type': { S: 'none' },
          },
          ReturnValues: 'ALL_NEW',
        };

        dynamo
          .updateItem(params, (err) => {
            if (err) {
              console.log('Error', err);
            }
          })
          .promise();
      }

      const requestMessages = [...alarmMessages, ...deleteMessages];

      const params = {
        RequestItems: {
          Alarms: requestMessages,
        },
      };

      // console.log("[#########ALARM MESSAGES#######]", JSON.stringify(params, null, 2))

      if (requestMessages.length > 0) {
        console.log('Adding a new ALARM...');
        console.log(`Writing data: ${JSON.stringify(params, null, 2)}`);
        await dynamo
          .batchWriteItem(params, (err, data) => {
            if (err) {
              console.log('Error', err);
            } else {
              console.log('Success', data);
            }
          })
          .promise();
      }
      console.log('No messages written', txid);
    }),
  );
};
