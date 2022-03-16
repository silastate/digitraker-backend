'use strict';

const AWS = require('aws-sdk');
const handleGateways = require('./handleGateways');
const { getEscalations, recursiveScan } = require('./utils');

AWS.config.update({ region: 'us-east-2' });

const dynamo = new AWS.DynamoDB({ apiVersion: '2012-08-10' });
const lambda = new AWS.Lambda();

const handleTimeout = (sensor, timeoutEscalation, alarms) => {
  // console.log("HANDLETIMEOUT", sensor.txid.S)

  const timeoutActions = timeoutEscalation.actions.L.map((action) => action.M);
  const timeoutAlarms = alarms.filter(
    (a) => a.txid.S === sensor.txid.S && a.alarmType.S === 'timeout'
  );

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
  let currentEscalation = escalations.find(
    (e) => e.order.N === currentOrder.toString()
  );

  const hasNextEscalation = !!nextEscalation;

  if (hasNextEscalation) {
    currentEscalation = nextEscalation;
  }

  const delay = !currentEscalation
    ? Date.now()
    : parseInt(currentEscalation.delay.N, 10) * 60 * 1000;

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

    const alarmActions = !currentEscalation?.actions
      ? []
      : currentEscalation.actions.L.map((action) => action.M);

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

module.exports = async (sensors) => {
  const alarms = await recursiveScan(dynamo, {
    TableName: 'Alarms',
    FilterExpression: 'alarmOn = :o',
    ExpressionAttributeValues: {
      ':o': { BOOL: true },
    },
  });

  const escalationTable = await recursiveScan(dynamo, {
    TableName: 'Escalation',
    FilterExpression:
      'attribute_not_exists(deleted) OR deleted = :deletedFalse',
    ExpressionAttributeValues: {
      ':deletedFalse': { BOOL: false },
    },
  });

  const gatewayTable = await recursiveScan(dynamo, {
    TableName: 'Gateways',
    FilterExpression:
      'attribute_not_exists(deleted) OR deleted = :deletedFalse',
    ExpressionAttributeValues: {
      ':deletedFalse': { BOOL: false },
    },
  });

  let alarmMessagesToWrite = [];
  let sensorMessagesToWrite = [];
  let actionsToTake = [];

  const alarmGateways = await handleGateways(dynamo, {
    gatewayTable,
    escalationTable,
  });

  console.log('alarmGateways', alarmGateways);

  await Promise.all(
    sensors.map(async (sensor) => {
      const onHold = sensor.onHold ? sensor.onHold.BOOL : false;
      const sensorGatewayInAlarm = alarmGateways.includes(sensor.gateway?.S);

      console.log('sensorGatewayInAlarm', sensor, sensorGatewayInAlarm);

      if (!onHold && !sensorGatewayInAlarm) {
        // --- Get Sensor escalations;
        const escalations = getEscalations(
          escalationTable,
          sensor.escalations
        ).map((item, index) => ({
          ...item,
          order: { N: (index + 1).toString() },
        }));

        // --- Get Sensor timeout Escalation;
        const timeoutEscalation = getEscalations(
          escalationTable,
          sensor.escalationsTimeout
        );

        if (timeoutEscalation && timeoutEscalation.length > 0) {
          const timeoutMessageAndActions = handleTimeout(
            sensor,
            timeoutEscalation[0],
            alarms
          );

          sensorMessagesToWrite = [
            ...timeoutMessageAndActions.sensorMessagesToWrite,
            ...sensorMessagesToWrite,
          ];
          alarmMessagesToWrite = [
            ...timeoutMessageAndActions.alarmMessagesToWrite,
            ...alarmMessagesToWrite,
          ];
          actionsToTake = [
            ...timeoutMessageAndActions.actionsToTake,
            ...actionsToTake,
          ];
        }

        // --- Verify if need to create new alarms
        const alarmsOn = alarms.filter((a) => a.txid.S === sensor.txid.S);

        await alarmsOn.forEach((alarm) => {
          const alarmMessagesAndActions = handleAlarms(
            sensor,
            escalations,
            alarm
          );

          sensorMessagesToWrite = [
            ...alarmMessagesAndActions.sensorMessagesToWrite,
            ...sensorMessagesToWrite,
          ];
          alarmMessagesToWrite = [
            ...alarmMessagesAndActions.alarmMessagesToWrite,
            ...alarmMessagesToWrite,
          ];
          actionsToTake = [
            ...alarmMessagesAndActions.actionsToTake,
            ...actionsToTake,
          ];
        });
      }
    })
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
          // value = 0.015625 * (value - 4); // positive equation

          if (!unit.sensor.positive.BOOL) {
            // use negative equation
            value -= 0.125;
          }
        }
        break; // add equation to compute correct wc
      default:
        console.log(`${unit.sensor.txid.S} doesnt have unit configuration`);
    }

    // const coef = unit.sensor.coef ? unit.sensor.coef.N : "0"
    // value += parseFloat(coef)

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
              '%20'
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
          Data: `[${alarmType.toUpperCase()}] ${unit.sensor.name.S} at ${
            unit.sensor.location.S
          }.`,
        },
      },
      Source: 'no-reply@digitraker.com',
    };

    emailList = [emailMessage, ...emailList];
  });

  console.log(`emailList ${JSON.stringify(emailList, null, 2)}`);

  if (emailList.length > 0) {
    try {
      const params = {
        FunctionName: 'emailIntegration',
        Payload: JSON.stringify({
          emailList,
        }),
      };
      await lambda.invoke(params).promise();
    } catch (err) {
      console.log('CATCH EMAIL Integration', err);
    }
  }

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
            // value = 0.015625 * (value - 4); // positive equation
            if (!unit.sensor.positive.BOOL) {
              // use negative equation
              value -= 0.125;
            }
          }
          break; // add equation to compute correct wc
        default:
          console.log(`${unit.sensor.txid.S} doesnt have unit configuration`);
      }

      // const coef = unit.sensor.coef ? unit.sensor.coef.N : "0"
      // value += parseFloat(coef)

      // const formatedCreatedAt = formatDate(unit.alarm.createdAt.N);

      smsList.push({
        Message: `${
          new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }) +
          ' CST'
        }
Sensor: ${unit.sensor.name.S} (${unit.sensor.txid.S})
Location: ${unit.sensor.location.S} (Gateway: ${unit.sensor.clientId.S})
Alarm: ${alarmType}
Range Min: ${unit.sensor.rangeMin.N}${unit.sensor.unit.S}
Range Max: ${unit.sensor.rangeMax.N}${unit.sensor.unit.S}
Last Value: ${value.toFixed(2)}${unit.sensor.unit.S} `,
        PhoneNumber: contact,
      });
    });
  });

  console.log('smsList', JSON.stringify(smsList, null, 2));

  if (smsList.length > 0) {
    try {
      const params = {
        FunctionName: 'smsIntegration',
        Payload: JSON.stringify({
          smsList,
        }),
      };
      await lambda.invoke(params).promise();
    } catch (err) {
      console.log('CATCH SMS Integration', err);
    }
  }

  // #############################
  // ###### Voice Messages  ######
  // #############################

  const voiceActions = await actionsToTake.map((unit) => {
    const actions = [
      ...unit.actions.filter(
        (action) => action.type && action.type.S === 'voice'
      ),
    ];
    const contactList = actions.map(
      (action) => action.contact && action.contact.S
    );

    return {
      sensor: unit.sensor,
      alarm: unit.alarm,
      actions,
      contacts: contactList,
    };
  });

  const voiceList = [];
  voiceActions.forEach((unit) => {
    unit.contacts.forEach((contact) => {
      let alarmType = 'out of range';
      switch (unit.alarm.alarmType.S) {
        case 'outRange':
          alarmType = 'out of range';
          break;
        default:
          alarmType = unit.alarm.alarmType.S;
      }

      const baseMessage = `Hello, this is a message from Digitracker, you have an  ${alarmType} alarm at the Sensor ${unit.sensor.name.S}, located at ${unit.sensor.location.S}, You can view more info by going to the , app , dot , digitracker , dot, com, and check the alarm pending.`;

      voiceList.push({
        message: `${baseMessage} ${baseMessage} ${baseMessage} ${baseMessage} ${baseMessage}`,
        phoneNumber: `+${contact}`,
      });
    });
  });

  console.log('voiceList', JSON.stringify(voiceList, null, 2));

  try {
    voiceList.forEach(async ({ message, phoneNumber }) => {
      // ClickSend Integration
      const params = {
        FunctionName: 'clickSendVoiceIntegration',
        Payload: JSON.stringify({
          phoneNumber,
          message,
        }),
      };

      await lambda.invoke(params).promise();
    });
  } catch (err) {
    console.log('CATCH ClickSend Integration', err);
  }

  if (alarmMessagesToWrite.length > 0) {
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
