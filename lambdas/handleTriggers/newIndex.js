'use strict';

const AWS = require('aws-sdk');

AWS.config.update({ region: 'us-east-2' });

const dynamo = new AWS.DynamoDB({ apiVersion: '2012-08-10' });
const lambda = new AWS.Lambda();

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

const handleGateways = (gateway, escalation) => {
  const gatewayMessageToWrite = [];

  const alarmLastAction = gateway.alarmLastAction.N;
  const now = new Date().getTime();
  const diff = now - alarmLastAction;
  const diffMinutes = Math.floor(diff / 1000 / 60);
  const timeoutDelay = escalation.delay ? escalation.delay.N : 60;
  const alarmLastActionDiff = diffMinutes > timeoutDelay;
  const timeoutActions = escalation.actions ? escalation.actions.L.map((action) => action.M) : [];

  if (alarmLastActionDiff || parseInt(alarmLastAction, 10) === 0) {
    gatewayMessageToWrite.push({
      PutRequest: {
        Item: {
          ...gateway,
          alarmOn: { BOOL: true },
          alarmLastAction: { N: now.toString() },
        },
      },
    });
  }

  return {
    gatewayMessageToWrite,
  };
};

const getEscalations = (escalations, sensorEscalationIds) => {
  if (!sensorEscalationIds || !sensorEscalationIds.L.length) return [];

  const parsedIds = sensorEscalationIds.L.map((item) => item.S);

  return escalations.reduce((acc, value) => {
    if (parsedIds.includes(value.id.S)) {
      acc.push(value);
    }
    return acc;
  }, []);
};

exports.handler = async () => {
  const sensors = await recursiveScan({
    TableName: 'Sensors',
    FilterExpression: 'attribute_exists(clientId) AND attribute_not_exists(deleted) OR deleted = :deletedFalse',
    ExpressionAttributeValues: {
      ':deletedFalse': { BOOL: false },
    },
  });

  const alarms = await recursiveScan({
    TableName: 'Alarms',
    FilterExpression: 'alarmOn = :o',
    ExpressionAttributeValues: {
      ':o': { BOOL: true },
    },
  });

  const escalationTable = await recursiveScan({
    TableName: 'Escalation',
    FilterExpression: 'attribute_not_exists(deleted) OR deleted = :deletedFalse',
    ExpressionAttributeValues: {
      ':deletedFalse': { BOOL: false },
    },
  });

  const gatewayTable = await recursiveScan({
    TableName: 'Gateways',
    FilterExpression: 'attribute_not_exists(deleted) OR deleted = :deletedFalse',
    ExpressionAttributeValues: {
      ':deletedFalse': { BOOL: false },
    },
  });

  const alarmGateways = [];
  let alarmMessagesToWrite = [];
  let sensorMessagesToWrite = [];
  let actionsToTake = [];
  let gatewayMessageToWrite = [];

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

  await Promise.all(
    gatewayTable.map(async (gateway) => {
      const escalation = getEscalations(escalationTable, gateway.escalationsTimeout);
      const timeoutEscalation = escalation && escalation.length > 0 ? escalation[0] : null;

      if (timeoutEscalation) {
        const now = new Date().getTime();
        const diff = now - gateway.lastHeartbeat.N;
        const diffMinutes = Math.floor(diff / 1000 / 60);
        const timeoutDelay = timeoutEscalation.delay ? timeoutEscalation.delay.N : 60;
        const gatewayIsOnTimeout = diffMinutes > timeoutDelay;

        if (gatewayIsOnTimeout) {
          alarmGateways.push(gateway.gatewayId);
          const handleGatewayActions = await handleGateways(gateway, timeoutEscalation);
          gatewayMessageToWrite = [...gatewayMessageToWrite, ...handleGatewayActions.gatewayMessageToWrite];
        }

        if (!gatewayIsOnTimeout && gateway.alarmOn.BOOL) {
          // RESET THE ALARM ON THE GATEWAY
          gatewayMessageToWrite.push({
            PutRequest: {
              Item: {
                ...gateway,
                alarmOn: { BOOL: false },
                deleted: { BOOL: false },
                alarmLastAction: { N: '0' },
              },
            },
          });
        }
      }
      // const alarmMessagesAndActions = handleGateways(gateway, timeoutEscalation[0], alarm);
    }),
  );

  if (gatewayMessageToWrite.length) {
    const gatewayParams = {
      RequestItems: {
        Gateways: gatewayMessageToWrite,
      },
    };

    console.log('gatewayParams', JSON.stringify(gatewayParams));
    await dynamo
      .batchWriteItem(gatewayParams, (err, data) => {
        if (err) {
          console.log('gatewayMessageToWrite - Error ', err);
        } else {
          console.log('gatewayMessageToWrite - Success', data);
        }
      })
      .promise();
  }

  await Promise.all(
    sensors.map(async (sensor) => {
      const onHold = sensor.onHold ? sensor.onHold.BOOL : false;

      if (!onHold) {
        // --- Get Sensor escalations;
        const escalations = getEscalations(escalationTable, sensor.escalations).map((item, index) => ({
          ...item,
          order: { N: (index + 1).toString() },
        }));

        // --- Get Sensor timeout Escalation;
        const timeoutEscalation = getEscalations(escalationTable, sensor.escalationsTimeout);

        if (timeoutEscalation && timeoutEscalation.length > 0) {
          const timeoutMessageAndActions = handleTimeout(sensor, timeoutEscalation[0], alarms);

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
        Message: `${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }) + ' CST'}
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
