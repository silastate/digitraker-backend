// eslint-disable-next-line strict
const AWS = require('aws-sdk');

AWS.config.update({ region: 'us-east-2' });

const dynamo = new AWS.DynamoDB.DocumentClient({ apiVersion: '2012-08-10' });

exports.lambdaHandler = async (event) => {
  const request = JSON.parse(event.body);

  const date1 = new Date(request.time1);
  const date2 = new Date(request.time2);

  const dateLimit = Math.min.apply(null, [new Date(), date2]);

  const deltaMinutes = 10;
  let reqData = [];

  request.txids.forEach((txid) => {
    for (let date = new Date(date1.getTime()); date < dateLimit; date.setDate(date.getDate() + 1)) {
      //  year, month, day, hour, minute, second, millisecond
      const dateAm = new Date(date.getFullYear(), date.getMonth(), date.getDate(), request.hourAm, request.minAm, 0, 0);
      const datePm = new Date(date.getFullYear(), date.getMonth(), date.getDate(), request.hourPm, request.minPm, 0, 0);
      dateAm.setTime(dateAm.getTime() + request.timezone * 60 * 1000);
      datePm.setTime(datePm.getTime() + request.timezone * 60 * 1000);

      const newReqData = {
        txid,
        am: {
          start: new Date(dateAm.getTime() - deltaMinutes * 60 * 1000).getTime(),
          stop: new Date(dateAm.getTime() + deltaMinutes * 60 * 1000).getTime(),
        },
        pm: {
          start: new Date(datePm.getTime() - deltaMinutes * 60 * 1000).getTime(),
          stop: new Date(datePm.getTime() + deltaMinutes * 60 * 1000).getTime(),
        },
      };

      reqData = [...reqData, newReqData];
    }
  });

  let results = [];

  const promises = reqData.map(async (req) => {
    const infoParams = {
      TableName: 'Sensors',
      KeyConditionExpression: 'txid = :info',
      ExpressionAttributeValues: {
        ':info': req.txid,
      },
    };
    // 	console.log(infoParams)

    const infoPromise = await dynamo.query(infoParams).promise();

    const dataAmParams = {
      TableName: 'Readings',
      KeyConditionExpression: 'txid = :data AND createdAt BETWEEN :start AND :stop',
      ExpressionAttributeValues: {
        ':data': req.txid,
        ':start': parseInt(req.am.start, 10),
        ':stop': parseInt(req.am.stop, 10),
      },
    };
    const amPromise = await dynamo.query(dataAmParams).promise();

    const dataPmParams = {
      TableName: 'Readings',
      KeyConditionExpression: 'txid = :data AND createdAt BETWEEN :start AND :stop',
      ExpressionAttributeValues: {
        ':data': req.txid,
        ':start': parseInt(req.pm.start, 10),
        ':stop': parseInt(req.pm.stop, 10),
      },
    };

    const pmPromise = await dynamo.query(dataPmParams).promise();

    return {
      txid: req.txid,
      info: infoPromise,
      am: amPromise,
      pm: pmPromise,
    };
  });

  const query = await Promise.all(promises);

  results = request.txids.map((txid) => {
    const filterTxid = query.filter((obj) => {
      return obj.txid === txid;
    });

    const readingsForOneTxid = filterTxid.map((reading) => {
      if (reading.am.Count > 0 && reading.pm.Count > 0) {
        const countAm = parseInt(reading.am.Count / 2, 10);
        const countPm = parseInt(reading.pm.Count / 2, 10);

        return {
          am: {
            value: reading.am.Items[countAm].value,
            time: reading.am.Items[countAm].createdAt,
          },
          pm: {
            value: reading.pm.Items[countPm].value,
            time: reading.pm.Items[countPm].createdAt,
          },
        };
      }

      return {
        am: {
          value: 9999,
          time: 0,
        },
        pm: {
          value: 9999,
          time: 0,
        },
      };
    });

    return {
      txid,
      info: filterTxid[0].info.Items[0],
      data: readingsForOneTxid,
    };
  });

  const response = {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'OPTIONS,POST,GET',
    },
    body: JSON.stringify(results),
  };

  return response;
};
