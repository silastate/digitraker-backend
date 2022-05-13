const AWS = require('aws-sdk');

const checkIfIsOutRange = (heartbeats, rangeMaxAll) =>
  Object.keys(heartbeats)
    .map((key) => heartbeats[key] > rangeMaxAll[key])
    .includes(true);

const updateSensorAlarmOn = async (dynamo, txid) => {
  console.log('updateSensorAlarmOn');
  const updateSensorParams = {
    TableName: 'ParticleCounterSensors',
    Key: {
      txid: { S: txid },
      createdAt: { N: '0' },
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

  return await dynamo
    .updateItem(updateSensorParams, (err) => {
      if (err) {
        console.log('Error', err);
      }
    })
    .promise();
};

const updateSensorAlarmOff = async (dynamo, txid) => {
  console.log('updateSensorAlarmOff');
  const updateSensorParams = {
    TableName: 'ParticleCounterSensors',
    Key: {
      txid: { S: txid },
      createdAt: { N: '0' },
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

  return await dynamo
    .updateItem(updateSensorParams, (err) => {
      if (err) {
        console.log('Error', err);
      }
    })
    .promise();
};

const createAlarm = async (dynamo, txid) => {
  console.log('createAlarm');
  const createAlarmParams = {
    TableName: 'Alarms',
    Item: {
      txid: { S: txid },
      createdAt: { N: new Date().getTime().toString() },
      closedAt: { N: '-1' },
      alarmOn: { BOOL: true },
      alarmType: { S: 'outRange' },
      alarmId: { N: new Date().getTime().toString() },
      escalation: { N: '0' },
      hasEscalation: { BOOL: false },
      lastEscalation: {
        N: '0',
      },
    },
  };

  return await dynamo
    .putItem(createAlarmParams, (err) => {
      if (err) {
        console.log('Error', err);
      }
    })
    .promise();
};

const deleteAlarm = async (dynamo, txid, alarmId) => {
  console.log('deleteAlarm');
  const createAlarmParams = {
    TableName: 'Alarms',
    Key: {
      txid: { S: txid },
      alarmId: { N: alarmId },
    },
  };

  return await dynamo
    .deleteItem(createAlarmParams, (err) => {
      if (err) {
        console.log('Error', err);
      }
    })
    .promise();
};

module.exports = async (dynamo, data) => {
  const parsedData = AWS.DynamoDB.Converter.unmarshall(data);

  const txid = data?.txid?.S;

  const params = {
    TableName: 'Alarms',
    KeyConditionExpression: 'txid=:txid',
    ExpressionAttributeValues: {
      ':txid': { S: txid },
    },
  };

  const alarms = await dynamo.query(params).promise();
  const openAlarms =
    alarms?.Items?.filter((alarm) => alarm?.closedAt?.N === -1) || [];
  const { heartbeats, rangeMaxAll } = parsedData;

  const hasAlarm = !!openAlarms?.length;
  const isOutRange = checkIfIsOutRange(heartbeats, rangeMaxAll);

  console.log('hasAlarm', hasAlarm);
  console.log('isOutRange', isOutRange);

  if (!hasAlarm && isOutRange) {
    await updateSensorAlarmOn(dynamo, txid);
    await createAlarm(dynamo, txid);
  }

  if (hasAlarm && !isOutRange) {
    const alarm = alarms.Items[0];

    await updateSensorAlarmOff(dynamo, txid);
    await deleteAlarm(dynamo, txid, alarm?.alarmId?.N);
  }

  return null;
};
