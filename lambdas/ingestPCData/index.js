'use strict';

const AWS = require('aws-sdk');
AWS.config.update({ region: 'us-east-2' });

const dynamo = new AWS.DynamoDB({ apiVersion: '2012-08-10' });

const handleAlarms = require('./handleAlarms');

const ingestData = async (data) => {
  const params = {
    TableName: 'ParticleCounterReadings',
    Item: data,
  };

  return await dynamo.putItem(params).promise();
};

const updateHeartbeat = async (data) => {
  const lastHeartbeat = { N: Date.now()?.toString() };
  const heartbeat = { N: data?.channel3?.S?.toString() };
  const heartbeats = {
    M: {
      channel1: { N: data?.channel1?.S?.toString() },
      channel2: { N: data?.channel2?.S?.toString() },
      channel3: { N: data?.channel3?.S?.toString() },
      channel4: { N: data?.channel4?.S?.toString() },
    },
  };

  const params = {
    TableName: 'ParticleCounterSensors',
    Key: {
      txid: { S: data?.txid?.S },
      createdAt: { N: '0' },
    },
    ExpressionAttributeNames: {
      '#heartbeat': 'heartbeat',
      '#heartbeats': 'heartbeats',
      '#lastHeartbeat': 'lastHeartbeat',
    },
    UpdateExpression:
      'set #heartbeat = :heartbeat, #heartbeats = :heartbeats, #lastHeartbeat = :lastHeartbeat ',
    ExpressionAttributeValues: {
      ':lastHeartbeat': lastHeartbeat,
      ':heartbeat': heartbeat,
      ':heartbeats': heartbeats,
    },
    ReturnValues: 'ALL_NEW',
  };

  return await dynamo.updateItem(params).promise();
};

const handleError = (error, message) => {
  console.log(message, ': ', error);

  return {
    statusCode: 500,
    body: JSON.stringify(message),
  };
};

exports.handler = async (event) => {
  const response = {
    statusCode: 200,
    body: JSON.stringify(event),
  };

  const pcInfoParams = {
    TableName: 'ParticleCounterSensors',
    KeyConditionExpression: 'txid=:txid',
    ExpressionAttributeValues: {
      ':txid': { S: event?.txid?.S },
    },
  };

  const pcInfo = await dynamo.query(pcInfoParams).promise();

  try {
    await ingestData(event);
  } catch (error) {
    return handleError(error, 'Error on insert data');
  }

  try {
    await updateHeartbeat(event);
  } catch (error) {
    return handleError(error, 'Error updating heartbeat');
  }

  try {
    await handleAlarms(dynamo, pcInfo?.Items?.[0]);
  } catch (error) {
    return handleError(error, 'Error handling alarms');
  }

  return response;
};
