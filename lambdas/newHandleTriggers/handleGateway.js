'use strict';

const utils = require('./utils');

module.exports = async (dynamo, { gatewayTable, escalationTable }) => {
  const alarmGateways = [];
  let gatewayMessageToWrite = [];

  await Promise.all(
    gatewayTable.map(async (gateway) => {
      const escalation = utils.getEscalations(escalationTable, gateway.escalationsTimeout);
      const timeoutEscalation = escalation && escalation.length > 0 ? escalation[0] : null;

      if (timeoutEscalation) {
        const now = new Date().getTime();
        const diff = now - gateway.lastHeartbeat.N;
        const diffMinutes = Math.floor(diff / 1000 / 60);
        const timeoutDelay = timeoutEscalation.delay ? timeoutEscalation.delay.N : 60;
        const gatewayIsOnTimeout = diffMinutes > timeoutDelay;

        if (gatewayIsOnTimeout) {
          alarmGateways.push(gateway.gatewayId);
          const handleGatewayActions = await handleGateway(gateway, timeoutEscalation);
          gatewayMessageToWrite = [...gatewayMessageToWrite, ...handleGatewayActions.gatewayMessageToWrite];
        }

        if (!gatewayIsOnTimeout && gateway.alarmOn.BOOL) {
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
      // const alarmMessagesAndActions = handleGateways(gateway, timeoutEscalation[0], alarm);
    }),
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

  return [...alarmGateways];
};

const handleGateway = (gateway, escalation) => {
  const gatewayMessageToWrite = [];

  const alarmLastAction = gateway.alarmLastAction.N;
  const now = new Date().getTime();
  const diff = now - alarmLastAction;
  const diffMinutes = Math.floor(diff / 1000 / 60);
  const timeoutDelay = escalation.delay ? escalation.delay.N : 60;
  const alarmLastActionDiff = diffMinutes > timeoutDelay;
  const timeoutActions = escalation.actions ? escalation.actions.L.map((action) => action.M) : [];

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
  }

  // SEND ACTIONS
  
  return {
    gatewayMessageToWrite,
  };
};
