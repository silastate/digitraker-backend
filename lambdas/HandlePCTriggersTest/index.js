'use strict';

const AWS = require('aws-sdk');
AWS.config.update({ region: 'us-east-2' });

const dynamo = new AWS.DynamoDB({ apiVersion: '2012-08-10' });
// const lambda = new AWS.Lambda();
const { getEscalations, isOnSchedule } = require('./utils');
const { handleTimeout } = require('./handleTimeouts');
const { handleAlarms } = require('./handleAlarms');
const { handleActions } = require('./handleActions');

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
    const parsedSensor = AWS.DynamoDB.Converter.unmarshall(sensor);

    console.log('---------------------------------------------------------');
    console.log('Processing Sensor =>', parsedSensor.txid);

    if (parsedSensor?.onHold) {
      console.log('SENSOR ON HOLD:', parsedSensor.txid);
      return;
    }

    if (!isOnSchedule(parsedSensor?.schedule)) {
      console.log('SENSOR OUT OF SCHEDULE:', parsedSensor.txid);
      return;
    }

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
  });

  console.log('-------------------------------------------------------------');

  await handleActions(actionsToTake);

  const response = {
    statusCode: 200,
    body: {
      actionsToTake,
    },
  };

  // Write Alarms
  if (alarmMessagesToWrite.length > 0) {
    for (let i = 0; i < alarmMessagesToWrite.length; i += 25) {
      const params = {
        RequestItems: {
          Alarms: alarmMessagesToWrite.slice(i, i + 25),
        },
      };

      console.log('alarmMessagesToWrite - Params', JSON.stringify(params));
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

  // Update Sensors
  if (sensorMessagesToWrite.length > 0) {
    console.log('sensorMessagesToWrite', sensorMessagesToWrite);

    for (let i = 0; i < sensorMessagesToWrite.length; i += 25) {
      const params = {
        RequestItems: {
          ParticleCounterSensors: sensorMessagesToWrite.slice(i, i + 25),
        },
      };

      console.log('sensorMessagesToWrite - Params', JSON.stringify(params));
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

  console.log('--------------------------- END ------------------------------');

  return response;
};
