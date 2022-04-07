const { recursiveScan } = require('./utils');

exports.dbGetAlarms = async (dynamo) =>
  await recursiveScan(dynamo, {
    TableName: 'Alarms',
    FilterExpression: 'alarmOn = :o',
    ExpressionAttributeValues: {
      ':o': { BOOL: true },
    },
  });

exports.dbGetEscalations = async (dynamo) =>
  await recursiveScan(dynamo, {
    TableName: 'Escalation',
    FilterExpression:
      'attribute_not_exists(deleted) OR deleted = :deletedFalse',
    ExpressionAttributeValues: {
      ':deletedFalse': { BOOL: false },
    },
  });

exports.dbGetParticleCounters = async (dynamo) =>
  await recursiveScan(dynamo, {
    TableName: 'ParticleCounterSensors',
    FilterExpression:
      'attribute_exists(clientId) AND attribute_not_exists(deleted) OR deleted = :deletedFalse',
    ExpressionAttributeValues: {
      ':deletedFalse': { BOOL: false },
    },
  });
