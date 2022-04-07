exports.handleTimeout = (sensor, timeoutEscalation, alarms) => {
  const timeoutActions =
    timeoutEscalation.actions?.L.map((action) => action.M) || [];
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
