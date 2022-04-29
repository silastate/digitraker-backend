'use strict';

const { formatInTimeZone } = require('date-fns-tz');

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

// const isBetweenSchedule = (nowTime, scheduleType) => {
//   const weekdaySchedule = scheduleType?.split('-');
//   const initTime = weekdaySchedule[0];
//   const endTime = weekdaySchedule[1];

//   if (nowTime >= initTime && nowTime <= endTime) {
//     return true;
//   }

//   return false;
// };

// exports.isBetweenSchedule = isBetweenSchedule;

// exports.isOnSchedule = (schedule) => {
//   console.log('schedule', schedule);

//   console.log('new Date', new Date());
//   console.log('Date.now()', Date.now());

//   const now = formatInTimeZone(new Date(), schedule.timezone, 'i-HH:mm')?.split(
//     '-'
//   );

//   const nowWeekDay = now[0];
//   const nowTime = now[1];

//   console.log('nowWeekDay', nowWeekDay);
//   console.log('nowTime', nowTime);

//   if (nowWeekDay >= 1 && nowWeekDay < 6 && schedule.weekday !== 'off') {
//     return isBetweenSchedule(nowTime, schedule.weekday);
//   }

//   if (nowWeekDay === '6' && schedule.saturday !== 'off') {
//     return isBetweenSchedule(nowTime, schedule.saturday);
//   }

//   if (nowWeekDay === '7' && schedule.sunday !== 'off') {
//     return isBetweenSchedule(nowTime, schedule.sunday);
//   }

//   return false;
// };
