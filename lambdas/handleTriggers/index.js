'use strict';

const AWS = require('aws-sdk');

AWS.config.update({ region: 'us-east-2' });

const dynamo = new AWS.DynamoDB({ apiVersion: '2012-08-10' });
//const dynamo = new AWS.DynamoDB();

const version200 = require('./version200');
console.log("Final List 11: " );
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
console.log("Final List 12: " );

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

  const response = await version200(sensors);

  return response;
};
