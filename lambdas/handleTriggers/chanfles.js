"use strict";

const AWS = require("aws-sdk");

AWS.config.update({ region: "us-east-2" });

const dynamo = new AWS.DynamoDB({ apiVersion: "2012-08-10" });
const lambda = new AWS.Lambda();

exports.handler = async(event) => {
  let sensors = await recursiveScan({
    TableName: "Sensors",
    FilterExpression: "attribute_exists(clientId)",
  });

  sensors = sensors.filter(
    (sensorItem) => sensorItem.deleted && !sensorItem.deleted.BOOL
  );

  const auburn = sensors.filter((s) => s.clientId.S === "Auburn");

  sensors = [...auburn];

  const alarms = await recursiveScan({
    TableName: "Alarms",
    FilterExpression: "alarmOn = :o",
    ExpressionAttributeValues: {
      ":o": { BOOL: true },
    },
  });

  let alarmMessagesToWrite = [];
  let sensorMessagesToWrite = [];
  let actionsToTake = [];

  const newEscalations = await recursiveScan({
    TableName: "Escalation",
    FilterExpression: "attribute_not_exists(deleted) OR deleted = :deletedFalse",
    ExpressionAttributeValues: {
      ":deletedFalse": { BOOL: false },
    },
  });

  await Promise.all(
    sensors.map(async(sensor) => {
      console.log("sensor", JSON.stringify(sensor));

      // --- Get Sensor escalations;
      const escalations = getEscalations(
        newEscalations,
        sensor.escalations
      ).map((item, index) => ({
        ...item,
        order: { N: (index + 1).toString() },
      }));

      // --- Get Sensor timeout Escalation;
      const timeoutEscalation = getEscalations(
        newEscalations,
        sensor.escalationsTimeout
      );

      console.log("timeoutEscalation", JSON.stringify(timeoutEscalation));
      console.log("normalEscalations", JSON.stringify(escalations));

      if (timeoutEscalation.length > 0) {
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
    })
  );

  console.log("sensorMessagesToWrite", JSON.stringify(sensorMessagesToWrite));
  console.log("alarmMessagesToWrite", JSON.stringify(alarmMessagesToWrite));
  console.log("actionsToTake", JSON.stringify(actionsToTake));

  return;
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
  const timeoutAlarms = alarms.filter(
    (a) => a.txid.S === sensor.txid.S && a.alarmType.S === "timeout"
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
          closedAt: { N: "-1" },
          closedBy: { S: "" },
          message: { S: "" },
          alarmOn: { BOOL: true },
          alarmType: { S: "timeout" },
          alarmId: { N: Date.now().toString() },
          escalation: { N: "-1" },
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
          alarmType: { S: "timeout" },
        },
      },
    });

    actionsToTake.push({
      sensor,
      actions: timeoutActions,
      alarm: {
        alarmType: {
          S: "timeout",
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

  // console.log('lastEscalationAt', lastEscalationAt);
  // console.log('currentOrder', currentOrder);
  // console.log('nextOrder', nextOrder);
  // console.log('nextEscalation', nextEscalation);
  // console.log('currentEscalation', currentEscalation);
  // console.log('hasNextEscalation', hasNextEscalation);

  if (hasNextEscalation) {
    currentEscalation = nextEscalation;
  }

  const delay = !currentEscalation ?
    Date.now() :
    parseInt(currentEscalation.delay.N, 10) * 60 * 1000;

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

    const alarmActions = !currentEscalation ? [] :
      currentEscalation.actions.L.map((action) => action.M);

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
