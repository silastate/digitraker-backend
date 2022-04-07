'use strict';

const AWS = require('aws-sdk');
AWS.config.update({ region: 'us-east-2' });

const dynamo = new AWS.DynamoDB({ apiVersion: '2012-08-10' });
// const lambda = new AWS.Lambda();
const { getEscalations } = require('./utils');
const { handleTimeout } = require('./handleTimeouts');
const { handleAlarms } = require('./handleAlarms');

const {
  dbGetAlarms,
  dbGetEscalations,
  dbGetParticleCounters,
} = require('./dynamo');

exports.handler = async () => {
  const dbSensors = await dbGetParticleCounters(dynamo);
  const dbEscalations = await dbGetEscalations(dynamo);
  const dbAlarms = await dbGetAlarms(dynamo);

  let alarmMessagesToWrite = [];
  let sensorMessagesToWrite = [];
  let actionsToTake = [];

  dbSensors.forEach((sensor) => {
    console.log('sensor foreach---------------', sensor);

    // -- Handle Timeout
    const timeoutEscalation = getEscalations(
      dbEscalations,
      sensor.escalationsTimeout
    );

    if (timeoutEscalation && timeoutEscalation.length > 0) {
      const timeoutMessageAndActions = handleTimeout(
        sensor,
        timeoutEscalation[0],
        dbAlarms
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

    // -- Handle OutOfRange;
    const escalations = getEscalations(dbEscalations, sensor.escalations).map(
      (item, index) => ({
        ...item,
        order: { N: (index + 1).toString() },
      })
    );

    const alarmsOn = dbAlarms.filter((a) => a.txid.S === sensor.txid.S);

    alarmsOn.forEach((alarm) => {
      const alarmMessagesAndActions = handleAlarms(sensor, escalations, alarm);

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
    //
  });

  const response = {
    statusCode: 200,
    body: {
      alarmMessagesToWrite,
      sensorMessagesToWrite,
      actionsToTake,
    },
  };

  return response;
};
