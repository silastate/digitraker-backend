'use strict';

const AWS = require('aws-sdk');
const lambda = new AWS.Lambda();

const utils = require('./utils');

const handleGateway = async (gateway, escalation) => {
  const gatewayMessageToWrite = [];

  const alarmLastAction = gateway.alarmLastAction?.N;
  const now = new Date().getTime();
  const diff = now - alarmLastAction;
  const diffMinutes = Math.ceil(diff / 1000 / 60);
  const timeoutDelay = escalation.delay ? escalation.delay.N : 60;
  const alarmLastActionDiff = diffMinutes >= timeoutDelay;
  const timeoutActions = escalation.actions
    ? escalation.actions.L.map((action) => action.M)
    : [];

  if (alarmLastActionDiff || parseInt(alarmLastAction, 10) === 0) {
    gatewayMessageToWrite.push({
      PutRequest: {
        Item: {
          ...gateway,
          alarmOn: { BOOL: true },
          alarmLastAction: { N: now.toString() },
        },
      },
    });

    const emailActionsToTake = timeoutActions.filter(
      (action) => action?.type?.S === 'email'
    );
    const smsActionsToTake = timeoutActions.filter(
      (action) => action?.type?.S === 'sms'
    );
    const voiceActionsToTake = timeoutActions.filter(
      (action) => action?.type?.S === 'voice'
    );

    await handleEmailActions(gateway, emailActionsToTake);
    await handleSMSActions(gateway, smsActionsToTake);
    await handleVoiceActions(gateway, voiceActionsToTake);
  }

  return {
    gatewayMessageToWrite,
  };
};

const handleEmailActions = async (gateway, actions) => {
  const contacts = actions.map((action) => action.contact.S);

  const emailMessage = {
    Destination: {
      ToAddresses: ['digitraker@gmail.com', ...contacts],
    },
    Message: {
      Body: {
        Text: {
          Data: `The Gateway ${gateway.gatewayId.S} located at ${
            gateway.clientId.S
          } has a timeout alarm active.\n
Please check the internet connection or verify if the gateway have some physical problem.\n
If you have any concerns, you can reach out to us at http://www.digitraker.com.\n
Gateway: ${gateway.gatewayId.S}
Alarm: Timeout
Last Message: ${new Date(Number(gateway.lastHeartbeat.N)).toLocaleString(
            'en-US',
            {
              timeZone: 'America/Chicago',
            }
          )} CST`,
        },
      },
      Subject: {
        Data: `${gateway.gatewayId.S} has a TIMEOUT alarm`,
      },
    },
    Source: 'no-reply@digitraker.com',
  };

  const emailList = [emailMessage];

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
};

const handleSMSActions = async (gateway, actions) => {
  const smsList = actions.map((action) => ({
    Message: `${new Date().toLocaleString('en-US', {
      timeZone: 'America/Chicago',
    })} CST
Gateway: ${gateway.gatewayId.S}
Location: ${gateway.clientId.S}
Alarm: TIMEOUT
Last Message: ${new Date(Number(gateway.lastHeartbeat.N)).toLocaleString(
      'en-US',
      {
        timeZone: 'America/Chicago',
      }
    )} CST`,
    PhoneNumber: action.contact.S,
  }));

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
};

const handleVoiceActions = async (gateway, actions) => {
  const voiceList = actions.map((action) => {
    const baseMessage = `Hello, this is a message from Digitracker, you have an  TIMEOUT alarm at the Gateway ${gateway.gatewayId.S}, located at ${gateway.clientId.S}, You can view more info by going to the , app , dot , digitracker , dot, com, and check the alarm pending.`;

    return {
      message: `${baseMessage} ${baseMessage} ${baseMessage} ${baseMessage} ${baseMessage}`,
      phoneNumber: `+${action.contact.S}`,
    };
  });

  console.log('voiceList', voiceList);

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

module.exports = async (dynamo, { gatewayTable, escalationTable }) => {
  const alarmGateways = [];
  let gatewayMessageToWrite = [];

  await Promise.all(
    gatewayTable.map(async (gateway) => {
      const escalation = utils.getEscalations(
        escalationTable,
        gateway.escalationsTimeout
      );
      const timeoutEscalation =
        escalation && escalation.length > 0 ? escalation[0] : null;

      if (timeoutEscalation) {
        const now = new Date().getTime();
        const diff = now - gateway.lastHeartbeat.N;
        const diffMinutes = Math.floor(diff / 1000 / 60);
        const timeoutDelay = timeoutEscalation.delay
          ? timeoutEscalation.delay.N
          : 60;
        const gatewayIsOnTimeout = diffMinutes > timeoutDelay;

        if (gatewayIsOnTimeout) {
          alarmGateways.push(gateway.gatewayId);
          const handleGatewayActions = await handleGateway(
            gateway,
            timeoutEscalation
          );
          gatewayMessageToWrite = [
            ...gatewayMessageToWrite,
            ...handleGatewayActions.gatewayMessageToWrite,
          ];
        }

        if (!gatewayIsOnTimeout && gateway?.alarmOn?.BOOL) {
          // RESET THE ALARM ON THE GATEWAY
          gatewayMessageToWrite.push({
            PutRequest: {
              Item: {
                ...gateway,
                alarmOn: { BOOL: false },
                deleted: { BOOL: false },
                alarmLastAction: { N: '0' },
              },
            },
          });
        }
      }
    })
  );

  if (gatewayMessageToWrite.length) {
    const gatewayParams = {
      RequestItems: {
        Gateways: gatewayMessageToWrite,
      },
    };

    console.log('gatewayParams', JSON.stringify(gatewayParams));
    await dynamo
      .batchWriteItem(gatewayParams, (err, data) => {
        if (err) {
          console.log('gatewayMessageToWrite - Error ', err);
        } else {
          console.log('gatewayMessageToWrite - Success', data);
        }
      })
      .promise();
  }

  if (alarmGateways?.length) {
    return alarmGateways.map((gateway) => gateway.S);
  }

  return [];
};
