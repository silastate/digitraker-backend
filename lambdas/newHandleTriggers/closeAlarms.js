'use strict';

const { getEscalations } = require('./utils');

const getSensorById = (sensorTable, sensorId) => sensorTable.find((sensor) => sensor.txid.S === sensorId);

exports.handleAutomaticTimeout = (alarms, sensors, escalations) => {
  if (!alarms || !alarms.length) {
    return null;
  }

  alarms.forEach((alarm) => {
    if (alarm.alarmType && alarm.alarmType.S === 'timeout') {
      console.log('------- ALARM -------');
      console.log('alarm:', alarm);

      const sensor = getSensorById(sensors, alarm.txid.S);
      console.log('sensor', sensor);

      if (!sensor) return null;

      const escalation = getEscalations(escalations, sensor.escalationsTimeout);
      const timeoutEscalation = escalation && escalation.length > 0 ? escalation[0] : null;
      console.log('escalation', escalation);
      console.log('timeoutEscalation', timeoutEscalation);
    }
  });

  return true;
};
