const AWS = require('aws-sdk');
const lambda = new AWS.Lambda();

exports.handleActions = async (actionsToTake) => {
  const emailActions = actionsToTake.map((unit) => {
    const actions = unit.actions.filter((a) => a.type.S === 'email') || [];
    const contactList = actions.map((action) => action.contact.S);

    return {
      sensor: unit.sensor,
      alarm: unit.alarm,
      actions,
      contacts: contactList,
    };
  });

  const smsActions = actionsToTake.map((unit) => {
    const actions = unit.actions.filter((a) => a.type.S === 'sms') || [];
    const contactList = actions.map((action) => action.contact.S);

    return {
      sensor: unit.sensor,
      alarm: unit.alarm,
      actions,
      contacts: contactList,
    };
  });

  const voiceActions = actionsToTake.map((unit) => {
    const actions = unit.actions.filter((a) => a.type.S === 'sms') || [];
    const contactList = actions.map((action) => action.contact.S);

    return {
      sensor: unit.sensor,
      alarm: unit.alarm,
      actions,
      contacts: contactList,
    };
  });

  console.log('emailActions', JSON.stringify(emailActions));

  await handleEmails(emailActions);
  await handleSMS(smsActions);
  await handleVoice(voiceActions);
};

const handleEmails = async (emailActions) => {
  const emailList = emailActions.map(({ sensor, alarm, contacts }) => {
    const alarmType = getAlarmType(alarm.alarmType.S);

    return {
      Destination: {
        ToAddresses: ['digitraker@gmail.com', ...contacts],
      },
      Message: {
        Body: {
          Text: {
            Data: `${sensor.name.S} (${sensor.txid.S}) located at ${
              sensor.location.S
            } has a pending an ${alarmType} alarm. You can view the sensor by going to http://app.digitraker.com/dashboard/pc/${sensor.location.S.replace(
              / /g,
              '%20'
            )}/${
              sensor.txid.S
            } and check the alarm pending. \n\nIf you have any concerns, you can reach out to us at http://www.digitraker.com.\n
    Sensor: ${sensor.name.S} (${sensor.txid.S})
    Location: ${sensor.location.S}
    Alarm: ${alarmType}
    Channels: ${getFormattedSensorValues(sensor)}`,
          },
        },
        Subject: {
          Data: `[${alarmType.toUpperCase()}] ${sensor.name.S} at ${
            sensor.location.S
          }.`,
        },
      },
      Source: 'no-reply@digitraker.com',
    };
  });

  if (emailList.length > 0) {
    try {
      const params = {
        FunctionName: 'emailIntegration',
        Payload: JSON.stringify({
          emailList,
        }),
      };
      await lambda.invoke(params).promise();
    } catch (err) {
      console.log('CATCH EMAIL Integration', err);
    }
  }
};

const handleSMS = async (smsActions) => {
  const smsList = [];
  smsActions.forEach(({ sensor, alarm, contacts }) => {
    contacts.forEach((contact) => {
      const alarmType = getAlarmType(alarm.alarmType.S);

      smsList.push({
        Message: `${
          new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }) +
          ' CST'
        }
Sensor: ${sensor.name.S} (${sensor.txid.S})
Location: ${sensor.location.S}
Alarm: ${alarmType}
Channels: ${getFormattedSensorValues(sensor, true)}`,
        PhoneNumber: contact,
      });
    });
  });

  if (smsList.length > 0) {
    try {
      const params = {
        FunctionName: 'smsIntegration',
        Payload: JSON.stringify({
          smsList,
        }),
      };
      await lambda.invoke(params).promise();
    } catch (err) {
      console.log('CATCH SMS Integration', err);
    }
  }
};

const handleVoice = async (voiceActions) => {
  const voiceList = [];
  voiceActions.forEach(({ sensor, alarm, contacts }) => {
    contacts.forEach((contact) => {
      const alarmType = getAlarmType(alarm.alarmType.S);
      const baseMessage = `Hello, this is a message from Digitracker, you have an  ${alarmType} alarm at the Sensor ${sensor.name.S}, located at ${sensor.location.S}, You can view more info by going to the , app , dot , digitracker , dot, com, and check the alarm pending.`;

      voiceList.push({
        message: `${baseMessage} ${baseMessage} ${baseMessage} ${baseMessage} ${baseMessage}`,
        phoneNumber: `+${contact}`,
      });
    });
  });
  try {
    voiceList.forEach(async ({ message, phoneNumber }) => {
      // ClickSend Integration
      const params = {
        FunctionName: 'clickSendVoiceIntegration',
        Payload: JSON.stringify({
          phoneNumber,
          message,
        }),
      };

      await lambda.invoke(params).promise();
    });
  } catch (err) {
    console.log('CATCH ClickSend Integration', err);
  }
};

// UTILS

const getAlarmType = (alarmType) => {
  switch (alarmType) {
    case 'outRange':
      return 'out of range';
    default:
      return alarmType;
  }
};

const getFormattedSensorValues = (sensor, sms) =>
  `
  ${sms ? '' : '    '}${sensor.particleSizes.M.channel1.N}${sensor.unit.S}: ${
    sensor.heartbeats.M.channel1.N
  } / Max: ${sensor.rangeMaxAll.M.channel1.N}
  ${sms ? '' : '    '}${sensor.particleSizes.M.channel2.N}${sensor.unit.S}: ${
    sensor.heartbeats.M.channel2.N
  } / Max: ${sensor.rangeMaxAll.M.channel2.N}
  ${sms ? '' : '    '}${sensor.particleSizes.M.channel3.N}${sensor.unit.S}: ${
    sensor.heartbeats.M.channel3.N
  } / Max: ${sensor.rangeMaxAll.M.channel3.N}
  ${sms ? '' : '    '}${sensor.particleSizes.M.channel4.N}${sensor.unit.S}: ${
    sensor.heartbeats.M.channel4.N
  } / Max: ${sensor.rangeMaxAll.M.channel4.N}
  `;
