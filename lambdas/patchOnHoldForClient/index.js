const AWS = require('aws-sdk');

AWS.config.update({ region: 'us-east-2' });

const dynamo = new AWS.DynamoDB({ apiVersion: '2012-08-10' });

const recursiveScan = (params, aItems = []) => {
  return dynamo
    .scan(params)
    .promise()
    .then((data) => {
      //  Simple Changes to input, optional
      let newItems = data.Items.map((item) => {
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


const updateSingleSensor =  (txid, onHold) => {
    
    // update Sensor with alarmOn and alarmType
    const updateParams = {
        TableName: "Sensors",
        Key: {
            txid: { "S": txid },
        },
        ExpressionAttributeNames: {
            "#onhold": "onHold",
        },
        UpdateExpression: "set #onhold = :onhold",
        ExpressionAttributeValues: {
            ":onhold": { "BOOL": onHold === 'true' },
        },
        ReturnValues: "ALL_NEW",
    };

    return dynamo.updateItem(updateParams, function (err, data) {
        if (err) { console.log("Error", err); }
        // console.log("Table UPDATED with this: " + JSON.stringify(data));
    }).promise();
}

exports.handler = async (event) => {
    
    const requestParams = event.params.querystring
    
    const sensors = await recursiveScan({
        TableName: 'Sensors',
        FilterExpression: 'clientId = :id',
        ExpressionAttributeValues: {
            ':id': { S: requestParams.clientId },
        }
    });

    const sensorPromises = sensors.map((sensor) => {
        return updateSingleSensor(sensor.txid.S, requestParams.onHold)
    })
    
    const allUpdatedSensors = await Promise.all(sensorPromises)
    
    const projectedUpdatedSensors = allUpdatedSensors.map((sensor) => {
        return {
            txid: sensor.Attributes.txid,
            onHold: sensor.Attributes.onHold,
        }
    })
    
    const response = {
        statusCode: 200,
        body: projectedUpdatedSensors,
    };
    
    return response;
};
