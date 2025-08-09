'use strict';
//const AWS = require('aws-sdk');

//AWS.config.update({ region: 'us-east-2' });
//const dynamo = new AWS.DynamoDB({ apiVersion: '2012-08-10' });


exports.getEscalations = (escalations, sensorEscalationIds) => {
      console.log("getEscalations sensorEscalationIds");
  if (!sensorEscalationIds || !sensorEscalationIds.L.length) return [];

  const parsedIds = sensorEscalationIds.L.map((item) => item.S);
 
  //DDW 11/21
  console.log("ParsedIDs", parsedIds);

  return escalations.reduce((acc, value) => {
    if (parsedIds.includes(value.id.S)) {
      acc.push(value);
    }
    return acc;
  }, []);
};


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
        // commenting this line to torubleshoot 12/13/2023 issue.
        console.log("Utils recursiveScan");
        if (params === undefined || aItems === undefined) {
          return;
        }else {
           return recursiveScan(dynamo, params, aItems);
        }
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

exports.recursiveScan = recursiveScan;
