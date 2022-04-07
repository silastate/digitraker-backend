exports.handleAlarms = (sensor, escalations, alarmParam) => {
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
