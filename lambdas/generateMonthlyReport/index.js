const AWS = require("aws-sdk");
AWS.config.update({ region: "us-east-2" });

const dynamo = new AWS.DynamoDB.DocumentClient({ apiVersion: "2012-08-10" });

exports.handler = async (event) => {
  // let request = {
  //   time1: 1598961600000, // 09/01/2020
  //   time2: 1601467200000, // 09/30/2020
  //   timezone: 360,
  //   hourAm: 7,
  //   minAm: 0,
  //   hourPm: 19,
  //   minPm: 0,
  //   txids: ["12674140_1","12673884_1"],
  // }

  let request = JSON.parse(event.body);
  const date1 = new Date(request.time1);
  const date2 = new Date(request.time2);
  const dateLimit = Math.min.apply(null, [new Date(), date2]);

  let deltaMinutes = 10;
  let reqData = [];

  request.txids.forEach((txid) => {
    for (
      let date = new Date(date1.getTime());
      date < dateLimit;
      date.setDate(date.getDate() + 1)
    ) {
      //  year, month, day, hour, minute, second, millisecond
      const dateAm = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        request.hourAm,
        request.minAm,
        0,
        0
      );
      const datePm = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        request.hourPm,
        request.minPm,
        0,
        0
      );
      dateAm.setTime(dateAm.getTime() + request.timezone * 60 * 1000);
      datePm.setTime(datePm.getTime() + request.timezone * 60 * 1000);

      let newReqData = {
        txid: txid,
        am: {
          start: new Date(
            dateAm.getTime() - deltaMinutes * 60 * 1000
          ).getTime(),
          stop: new Date(dateAm.getTime() + deltaMinutes * 60 * 1000).getTime(),
        },
        pm: {
          start: new Date(
            datePm.getTime() - deltaMinutes * 60 * 1000
          ).getTime(),
          stop: new Date(datePm.getTime() + deltaMinutes * 60 * 1000).getTime(),
        },
      };

      reqData = [...reqData, newReqData];
    }
  });

  let results = [];

  const promises = reqData.map(async (req) => {
    const info_params = {
      TableName: "Sensors",
      KeyConditionExpression: "txid = :info",
      ExpressionAttributeValues: {
        ":info": req.txid,
      },
    };

    const infoPromise = await dynamo.query(info_params).promise();

    const data_am_params = {
      TableName: "Readings",
      KeyConditionExpression:
        "txid = :data AND createdAt BETWEEN :start AND :stop",
      ExpressionAttributeValues: {
        ":data": req.txid,
        ":start": parseInt(req.am.start),
        ":stop": parseInt(req.am.stop),
      },
    };
    const amPromise = await dynamo.query(data_am_params).promise();

    const data_pm_params = {
      TableName: "Readings",
      KeyConditionExpression:
        "txid = :data AND createdAt BETWEEN :start AND :stop",
      ExpressionAttributeValues: {
        ":data": req.txid,
        ":start": parseInt(req.pm.start),
        ":stop": parseInt(req.pm.stop),
      },
    };
    const pmPromise = await dynamo.query(data_pm_params).promise();

    return {
      txid: req.txid,
      info: infoPromise,
      am: amPromise,
      pm: pmPromise,
    };
  });

  const query = await Promise.all(promises);

  results = request.txids.map((txid) => {
    const filter_txid = query.filter((obj) => {
      return obj.txid === txid;
    });

    const readings_for_one_txid = filter_txid.reduce((acc, reading) => {
      if (reading.am.Count > 0 && reading.pm.Count > 0) {
        const countAm = parseInt(reading.am.Count / 2);
        const countPm = parseInt(reading.pm.Count / 2);

        acc.push({
          am: {
            value: reading.am.Items[countAm].value,
            time: reading.am.Items[countAm].createdAt,
          },
          pm: {
            value: reading.pm.Items[countPm].value,
            time: reading.pm.Items[countPm].createdAt,
          },
        });
      }
      return acc;
    }, []);

    return {
      txid: txid,
      info: filter_txid?.[0]?.info?.Items?.[0],
      data: readings_for_one_txid,
    };
  });

  const response = {
    statusCode: 200,
    headers: {
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "OPTIONS,POST,GET",
    },
    body: JSON.stringify(results),
  };
  
  return response;
};
