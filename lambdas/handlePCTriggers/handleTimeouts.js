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
  const now = Date.now();
  const nowString = now.toString();

  const sendActions = () => {
    console.log('---- SEND ACTIONS ----');
    actionsToTake.push({
      sensor,
      actions: timeoutActions,
      alarm: {
        alarmType: {
          S: 'timeout',
        },
      },
    });
  };

  const updateSensor = () => {
    console.log('---- UPDATE SENSOR ----');
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
  };

  const updateAlarm = (alarm) => {
    console.log('---- UPDATE TIMEOUT ALARM');
    alarmMessagesToWrite.push({
      PutRequest: {
        Item: {
          ...alarm,
          lastEscalation: { N: nowString },
        },
      },
    });
  };

  const createTimeoutAlarm = () => {
    console.log('---- CREATE TIMEOUT ALARM ----');
    alarmMessagesToWrite.push({
      PutRequest: {
        Item: {
          txid: { S: sensor.txid.S },
          createdAt: { N: nowString },
          closedAt: { N: '-1' },
          closedBy: { S: '' },
          message: { S: '' },
          alarmOn: { BOOL: true },
          alarmType: { S: 'timeout' },
          alarmId: { N: nowString },
          escalation: { N: '-1' },
          hasEscalation: { BOOL: true },
          lastEscalation: { N: nowString },
        },
      },
    });
  };

  if (lastHB + delay < now) {
    // First escalation
    if (timeoutAlarms.length === 0) {
      createTimeoutAlarm();
      updateSensor();
      sendActions();
    }

    // Other escalations
    const timeoutAlarm = timeoutAlarms[0];
    const lastEscalation = parseInt(timeoutAlarm?.lastEscalation?.N, 10);
    if (lastEscalation + delay < now) {
      updateAlarm(timeoutAlarm);
      updateSensor();
      sendActions();
    }
  }

  return {
    alarmMessagesToWrite,
    actionsToTake,
    sensorMessagesToWrite,
  };
};
