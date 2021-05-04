'use strict';

const AWS = require('aws-sdk');

AWS.config.update({ region: 'us-east-2' });

const ses = new AWS.SES({ region: 'us-east-2' });
const sns = new AWS.SNS({ apiVersion: '2010-03-31' });

const dynamo = new AWS.DynamoDB({ apiVersion: '2012-08-10' });

// Init Pinpoint Service
const pinpointConfig = {
  region: 'us-east-1',
  originationNumber: '+19738335877',
  language: 'en-US',
  voiceId: 'Salli',
};
const pinpointSmsVoice = new AWS.PinpointSMSVoice({ region: pinpointConfig.region });

const recursiveScan = (params, aItems = []) => {
  return dynamo
    .scan(params)
    .promise()
    .then((data) => {
      //  Simple Changes to input, optional
      const newItems = data.Items.map((item) => {
        return item;
      });

      aItems = [...aItems, ...newItems];

      if (data.LastEvaluatedKey != null) {
        params.ExclusiveStartKey = data.LastEvaluatedKey;
        //  Recursive call, as deep as we can loop !
        return recursiveScan(params, aItems);
      }

      return Promise.resolve(aItems);
    })
    .then((items) => {
      if (items != null && items.length != null) {
        // console.log("Final List : " + items.length);
        return items;
      }
    })
    .catch((error) => {
      console.log(error);
      console.log(JSON.stringify(error));
    });
};

const handleTimeout = (sensor, timeoutEscalation, alarms) => {
  // console.log("HANDLETIMEOUT", sensor.txid.S)

  const timeoutActions = timeoutEscalation.actions.L.map((action) => action.M);
  const timeoutAlarms = alarms.filter((a) => a.txid.S === sensor.txid.S && a.alarmType.S === 'timeout');

  const alarmMessagesToWrite = [];
  const actionsToTake = [];
  const sensorMessagesToWrite = [];

  const delay = parseInt(timeoutEscalation.delay.N, 10) * 60 * 1000; // delay in ms
  const lastHB = parseInt(sensor.lastHeartbeat.N, 10);

  if (timeoutAlarms.length === 0 && lastHB + delay < Date.now()) {
    alarmMessagesToWrite.push({
      PutRequest: {
        Item: {
          txid: { S: sensor.txid.S },
          createdAt: { N: Date.now().toString() },
          closedAt: { N: '-1' },
          closedBy: { S: '' },
          message: { S: '' },
          alarmOn: { BOOL: true },
          alarmType: { S: 'timeout' },
          alarmId: { N: Date.now().toString() },
          escalation: { N: '-1' },
          lastEscalation: { N: Date.now().toString() },
        },
      },
    });

    sensorMessagesToWrite.push({
      PutRequest: {
        Item: {
          ...sensor,
          alarmOn: { BOOL: true },
          hasEscalation: { BOOL: true },
          alarmType: { S: 'timeout' },
        },
      },
    });

    actionsToTake.push({
      sensor,
      actions: timeoutActions,
      alarm: {
        alarmType: {
          S: 'timeout',
        },
      },
    });
  }

  return {
    alarmMessagesToWrite,
    actionsToTake,
    sensorMessagesToWrite,
  };
};

const handleAlarms = (sensor, escalations, alarmParam) => {
  const alarm = alarmParam;

  const alarmMessagesToWrite = [];
  const sensorMessagesToWrite = [];
  const actionsToTake = [];

  const lastEscalationAt = parseInt(alarm.lastEscalation.N, 10);
  const currentOrder = parseInt(alarm.escalation.N, 10);
  const nextOrder = (currentOrder + 1).toString();
  const nextEscalation = escalations.find((e) => e.order.N === nextOrder);
  let currentEscalation = escalations.find((e) => e.order.N === currentOrder.toString());

  const hasNextEscalation = !!nextEscalation;

  // console.log('lastEscalationAt', lastEscalationAt);
  // console.log('currentOrder', currentOrder);
  // console.log('nextOrder', nextOrder);
  // console.log('nextEscalation', nextEscalation);
  // console.log('currentEscalation', currentEscalation);
  // console.log('hasNextEscalation', hasNextEscalation);

  if (hasNextEscalation) {
    currentEscalation = nextEscalation;
  }

  const delay = !currentEscalation ? Date.now() : parseInt(currentEscalation.delay.N, 10) * 60 * 1000;

  if (lastEscalationAt + delay < Date.now()) {
    // increase escalation take actions
    if (hasNextEscalation) {
      alarm.escalation.N = nextOrder;
    }

    sensorMessagesToWrite.push({
      PutRequest: {
        Item: {
          ...sensor,
          hasEscalation: { BOOL: true },
        },
      },
    });

    alarm.lastEscalation.N = Date.now().toString();

    alarmMessagesToWrite.push({
      PutRequest: {
        Item: {
          ...alarm,
          hasEscalation: { BOOL: true },
        },
      },
    });

    const alarmActions = !currentEscalation ? [] : currentEscalation.actions.L.map((action) => action.M);

    actionsToTake.push({
      sensor,
      actions: alarmActions,
      alarm,
    });
  }

  return {
    sensorMessagesToWrite,
    alarmMessagesToWrite,
    actionsToTake,
  };
};

exports.handler = async () => {
  let sensors = await recursiveScan({
    TableName: 'Sensors',
    FilterExpression: 'attribute_exists(clientId)',
  });

  sensors = sensors.filter((s) => {
    if (!Object.keys(s).includes('deleted')) return true;
    if (s.deleted.BOOL !== true) return true;
    return false;
  });

  const alarms = await recursiveScan({
    TableName: 'Alarms',
    FilterExpression: 'alarmOn = :o',
    ExpressionAttributeValues: {
      ':o': { BOOL: true },
    },
  });

  let alarmMessagesToWrite = [];
  let sensorMessagesToWrite = [];
  let actionsToTake = [];

  // console.log(sensors, alarms)
  // const sensor1 = sensors.find((s) => s.txid.S === '1631197_0');
  // const sensor2 = sensors.find((s) => s.txid.S === '1631197_1');

  // const auburn = sensors.filter((s) => s.clientId.S === 'Auburn');
  // const healthcare = sensors.filter((s) => s.clientId.S === 'HealthCare');
  // const aurora = sensors.filter((s) => s.clientId.S === 'Aurora');
  // const dallas = sensors.filter((s) => s.clientId.S === 'DallasCounty');
  // const ellsworth = sensors.filter((s) => s.clientId.S === 'Ellsworth');
  // const olathelab = sensors.filter((s) => s.clientId.S === 'OlatheLab');

  // sensors = [
  // ... auburn,
  // ... healthcare,
  // ... aurora,
  // ... dallas,
  // ... ellsworth,
  // ... olathelab
  // ];

  // console.log(sensors)

  await Promise.all(
    sensors.map(async (sensor) => {
      // console.log(sensor.txid.S)
      const onHold = sensor.onHold ? sensor.onHold.BOOL : false;
      if (!onHold) {
        let escalations = await dynamo
          .query({
            TableName: 'Escalations',
            KeyConditionExpression: 'txid=:txid',
            ExpressionAttributeValues: {
              ':txid': { S: sensor.txid.S },
            },
          })
          .promise();

        escalations = escalations.Items;
        escalations = escalations.filter((e) => {
          if (!Object.keys(e).includes('deleted')) return true;
          if (e.deleted.BOOL !== true) return true;
          return false;
        });

        // --- Verify if need to create a new timeout alarm
        const timeoutEscalation = escalations.find((e) => e.order.N === '-1');

        if (timeoutEscalation) {
          const timeoutMessageAndActions = handleTimeout(sensor, timeoutEscalation, alarms);

          sensorMessagesToWrite = [...timeoutMessageAndActions.sensorMessagesToWrite, ...sensorMessagesToWrite];
          alarmMessagesToWrite = [...timeoutMessageAndActions.alarmMessagesToWrite, ...alarmMessagesToWrite];
          actionsToTake = [...timeoutMessageAndActions.actionsToTake, ...actionsToTake];
        }

        // --- Verify if need to create new alarms
        const alarmsOn = alarms.filter((a) => a.txid.S === sensor.txid.S);

        await alarmsOn.forEach((alarm) => {
          const alarmMessagesAndActions = handleAlarms(sensor, escalations, alarm);

          sensorMessagesToWrite = [...alarmMessagesAndActions.sensorMessagesToWrite, ...sensorMessagesToWrite];
          alarmMessagesToWrite = [...alarmMessagesAndActions.alarmMessagesToWrite, ...alarmMessagesToWrite];
          actionsToTake = [...alarmMessagesAndActions.actionsToTake, ...actionsToTake];
        });
      }
    }),
  );

  console.log('actionsToTake', JSON.stringify(actionsToTake, null, 2));
  const emailActions = await actionsToTake.map((unit) => {
    let actions = unit.actions.filter((a) => a.type.S === 'email');
    actions = [].concat(actions || []);
    const contactList = actions.map((action) => action.contact.S);
    // console.log(contactList)
    return {
      sensor: unit.sensor,
      alarm: unit.alarm,
      actions,
      contacts: contactList,
    };
  });

  let emailList = [];
  // console.log(emailActions);
  emailActions.forEach((unit) => {
    // console.log(unit.sensor.txid.S, unit.alarm.alarmType.S, action.contact.S)

    let alarmType = 'out of range';
    switch (unit.alarm.alarmType.S) {
      case 'outRange':
        alarmType = 'out of range';
        break;
      default:
        alarmType = unit.alarm.alarmType.S;
    }

    let value = parseFloat(unit.sensor.heartbeat.N);
    const pressure = unit.sensor.pressure ? unit.sensor.pressure.BOOL : false;

    switch (unit.sensor.unit ? unit.sensor.unit.S : '') {
      case 'F':
        break;
      case 'C':
        value = ((value - 32) * 5) / 9;
        break;
      case '%':
        break;
      case 'WC':
        if (pressure && value !== -9999) {
          const coef = parseFloat(unit.sensor.coef.N);
          value = 0.015625 * (value - 4) + coef; // positive equation
          if (!unit.sensor.positive.BOOL) {
            // use negative equation
            value -= 0.125;
          }
        }
        break; // add equation to compute correct wc
      default:
        console.log(`${unit.sensor.txid.S} doesnt have unit configuration`);
    }
    const emailMessage = {
      Destination: {
        ToAddresses: ['digitraker@gmail.com', ...unit.contacts],
      },
      Message: {
        Body: {
          Text: {
            Data: `${unit.sensor.name.S} (${unit.sensor.txid.S}) located at ${
              unit.sensor.location.S
            } has a pending an ${alarmType} alarm (Gateway: ${
              unit.sensor.clientId.S
            }). You can view the sensor by going to http://app.digitraker.com/dashboard/${unit.sensor.location.S.replace(
              / /g,
              '%20',
            )}/${
              unit.sensor.txid.S
            } and check the alarm pending. \n\nIf you have any concerns, you can reach out to us at http://www.digitraker.com.\n
Sensor: ${unit.sensor.name.S} (${unit.sensor.txid.S})
Location: ${unit.sensor.location.S} (Gateway: ${unit.sensor.clientId.S})
Alarm: ${alarmType}
Range Min: ${unit.sensor.rangeMin.N}${unit.sensor.unit.S}
Range Max: ${unit.sensor.rangeMax.N}${unit.sensor.unit.S}
Last Value: ${value.toFixed(2)}${unit.sensor.unit.S}`,
          },
        },
        Subject: {
          Data: `[${alarmType.toUpperCase()}] ${unit.sensor.name.S} at ${unit.sensor.location.S}.`,
        },
      },
      Source: 'no-reply@digitraker.com',
    };

    emailList = [emailMessage, ...emailList];
  });

  console.log(`emailList ${JSON.stringify(emailList, null, 2)}`);

  await Promise.all(
    emailList.map(async (email) => {
      await ses.sendEmail(email).promise();
    }),
  );

  const smsActions = await actionsToTake.map((unit) => {
    let actions = unit.actions.filter((a) => a.type.S === 'sms');
    actions = [].concat(actions || []);
    const contactList = actions.map((action) => action.contact.S);
    return {
      sensor: unit.sensor,
      alarm: unit.alarm,
      actions,
      contacts: contactList,
    };
  });

  const smsList = [];
  smsActions.forEach((unit) => {
    // #########################################
    // ##### used for sms testing ONLY #########
    // #########################################

    const sendOnlyTo = ['HealthCare', 'Auburn', 'Aurora'];
    const clientId = unit.sensor.clientId.S;
    if (!sendOnlyTo.includes(clientId)) {
      return;
    }

    // #########################################
    // #########################################

    unit.contacts.forEach((contact) => {
      let alarmType = 'out of range';
      switch (unit.alarm.alarmType.S) {
        case 'outRange':
          alarmType = 'out of range';
          break;
        default:
          alarmType = unit.alarm.alarmType.S;
      }

      let value = parseFloat(unit.sensor.heartbeat.N);
      const pressure = unit.sensor.pressure ? unit.sensor.pressure.BOOL : false;

      switch (unit.sensor.unit ? unit.sensor.unit.S : '') {
        case 'F':
          break;
        case 'C':
          value = ((value - 32) * 5) / 9;
          break;
        case '%':
          break;
        case 'WC':
          if (pressure && value !== -9999) {
            const coef = parseFloat(unit.sensor.coef.N);
            value = 0.015625 * (value - 4) + coef; // positive equation
            if (!unit.sensor.positive.BOOL) {
              // use negative equation
              value -= 0.125;
            }
          }
          break; // add equation to compute correct wc
        default:
          console.log(`${unit.sensor.txid.S} doesnt have unit configuration`);
      }

      // const formatedCreatedAt = formatDate(unit.alarm.createdAt.N);

      smsList.push({
        Message: `Sensor: ${unit.sensor.name.S} (${unit.sensor.txid.S})
Location: ${unit.sensor.location.S} (Gateway: ${unit.sensor.clientId.S})
Alarm: ${alarmType}
Range Min: ${unit.sensor.rangeMin.N}${unit.sensor.unit.S}
Range Max: ${unit.sensor.rangeMax.N}${unit.sensor.unit.S}
Last Value: ${value.toFixed(2)}${unit.sensor.unit.S}`,
        PhoneNumber: contact,
      });
    });
  });

  console.log('smsList', JSON.stringify(smsList, null, 2));

  await Promise.all(
    smsList.map(async (sms) => {
      await sns.publish(sms).promise();
    }),
  );

  // #########################################
  // ###### Pinpoint Voice Messages  #########
  // #########################################

  const voiceActions = await actionsToTake.map((unit) => {
    const actions = [...unit.actions.filter((action) => action.type && action.type.S === 'voice')];
    const contactList = actions.map((action) => action.contact && action.contact.S);

    return {
      sensor: unit.sensor,
      alarm: unit.alarm,
      actions,
      contacts: contactList,
    };
  });

  const voiceList = [];
  voiceActions.forEach((unit) => {
    const sendOnlyTo = ['Auburn'];
    const clientId = unit.sensor.clientId.S;

    if (!sendOnlyTo.includes(clientId)) {
      return;
    }

    unit.contacts.forEach((contact) => {
      let alarmType = 'out of range';
      switch (unit.alarm.alarmType.S) {
        case 'outRange':
          alarmType = 'out of range';
          break;
        default:
          alarmType = unit.alarm.alarmType.S;
      }

      let value = parseFloat(unit.sensor.heartbeat.N);
      const pressure = unit.sensor.pressure ? unit.sensor.pressure.BOOL : false;

      switch (unit.sensor.unit ? unit.sensor.unit.S : '') {
        case 'F':
          break;
        case 'C':
          value = ((value - 32) * 5) / 9;
          break;
        case '%':
          break;
        case 'WC':
          if (pressure && value !== -9999) {
            const coef = parseFloat(unit.sensor.coef.N);
            value = 0.015625 * (value - 4) + coef; // positive equation
            if (!unit.sensor.positive.BOOL) {
              // use negative equation
              value -= 0.125;
            }
          }
          break; // add equation to compute correct wc
        default:
          console.log(`${unit.sensor.txid.S} doesnt have unit configuration`);
      }

      voiceList.push({
        message: `<speak> 
          Hello, this is a message from Digitracker, you have an ${alarmType} 
          alarm at the Sensor ${unit.sensor.name.S}, located at ${unit.sensor.location.S}.
          You can view more info by going to the <break time="0.2s" />' +
          app
          <break time="0.2s" />
          dot
          <break time="0.2s" />
          digitracker
          <break time="0.2s" />
          dot
          <break time="0.2s" />
          com,
          and check the alarm pending.
        </speak>`,
        phoneNumber: contact,
      });
    });
  });

  console.log('voiceList', JSON.stringify(voiceList, null, 2));

  try {
    await Promise.all(
      voiceList.map(async ({ message, phoneNumber }) => {
        const params = {
          Content: {
            SSMLMessage: {
              LanguageCode: pinpointConfig.language,
              Text: message,
              VoiceId: pinpointConfig.voiceId,
            },
          },
          DestinationPhoneNumber: phoneNumber,
          OriginationPhoneNumber: pinpointConfig.originationNumber,
        };

        await pinpointSmsVoice
          .sendVoiceMessage(params, (err, data) => {
            if (err) {
              console.log('sendVoiceMessage - Error', err);
            } else {
              console.log('sendVoiceMessage - Success', data);
            }
          })
          .promise();
      }),
    );
  } catch (err) {
    console.log('CATCH pinpointSmsVoice', err);
  }

  // console.log("MESSAGES TO WRITE " + JSON.stringify(alarmMessagesToWrite, null, 2))

  if (alarmMessagesToWrite.length > 0) {
    // console.log('alarmMessagesToWrite', alarmMessagesToWrite);

    for (let i = 0; i < alarmMessagesToWrite.length; i += 25) {
      const params = {
        RequestItems: {
          Alarms: alarmMessagesToWrite.slice(i, i + 25),
        },
      };

      console.log('alarmMessagesToWrite - Params', params);
      await dynamo
        .batchWriteItem(params, (err, data) => {
          if (err) {
            console.log('alarmMessagesToWrite - Error', err);
          } else {
            console.log('alarmMessagesToWrite - Success', data);
          }
        })
        .promise();
    }
  }

  if (sensorMessagesToWrite.length > 0) {
    console.log('sensorMessagesToWrite', sensorMessagesToWrite);

    for (let i = 0; i < sensorMessagesToWrite.length; i += 25) {
      const params = {
        RequestItems: {
          Sensors: sensorMessagesToWrite.slice(i, i + 25),
        },
      };

      console.log('sensorMessagesToWrite - Params', params);
      await dynamo
        .batchWriteItem(params, (err, data) => {
          if (err) {
            console.log('sensorMessagesToWrite - Error ', err);
          } else {
            console.log('sensorMessagesToWrite - Success', data);
          }
        })
        .promise();
    }
  }

  const response = {
    statusCode: 200,
    body: JSON.stringify(emailList),
  };
  return response;
};
