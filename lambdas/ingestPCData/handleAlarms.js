const AWS = require('aws-sdk');

const checkIfIsOutRange = (heartbeats, rangeMaxAll) =>
  Object.keys(heartbeats)
    .map((key) => heartbeats[key] > rangeMaxAll[key])
    .includes(true);

const updateSensorAlarmOn = async (dynamo, txid) => {
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
    FilterExpression: 'hasEscalation = :hasEscalation',
    ExpressionAttributeValues: {
      ':txid': { S: txid },
      ':hasEscalation': { BOOL: false },
    },
  };

  const alarms = await dynamo.query(params).promise();

  const { heartbeats, rangeMaxAll } = parsedData;

  const hasAlarm = alarms.Count !== 0;
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
