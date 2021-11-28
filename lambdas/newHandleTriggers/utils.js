'use strict';

exports.getEscalations = (escalations, sensorEscalationIds) => {
  if (!sensorEscalationIds || !sensorEscalationIds.L.length) return [];

  const parsedIds = sensorEscalationIds.L.map((item) => item.S);

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

exports.recursiveScan = recursiveScan;


