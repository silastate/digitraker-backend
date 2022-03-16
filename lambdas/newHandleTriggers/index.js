'use strict';

const AWS = require('aws-sdk');

AWS.config.update({ region: 'us-east-2' });

const dynamo = new AWS.DynamoDB({ apiVersion: '2012-08-10' });

const version100 = require('./version100');
const version200 = require('./version200');

const CLIENTS_USING_NEW_ALARMS = ['Auburn', 'DrVince'];

const recursiveScan = (dynamo, params, aItems = []) => {
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

exports.handler = async () => {
  const sensors = await recursiveScan(dynamo, {
    TableName: 'Sensors',
    FilterExpression:
      'attribute_exists(clientId) AND attribute_not_exists(deleted) OR deleted = :deletedFalse',
    ExpressionAttributeValues: {
      ':deletedFalse': { BOOL: false },
    },
  });

  const sensorsV100 = sensors.filter(
    (s) => !CLIENTS_USING_NEW_ALARMS.includes(s.clientId.S)
  );
  const sensorsV200 = sensors.filter((s) =>
    CLIENTS_USING_NEW_ALARMS.includes(s.clientId.S)
  );

  const responseV100 = await version100(sensorsV100);
  console.log('responseV100', responseV100);

  const responseV200 = await version200(sensorsV200);
  console.log('responseV200', responseV200);

  const response = {
    statusCode: 200,
  };

  return response;
};
