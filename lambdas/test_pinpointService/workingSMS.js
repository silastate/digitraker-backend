'use strict';

const AWS = require('aws-sdk');

const pinpoint = new AWS.Pinpoint({ region: process.env.region });

// Make sure the SMS channel is enabled for the projectId that you specify.
// See: https://docs.aws.amazon.com/pinpoint/latest/userguide/channels-sms-setup.html
const projectId = process.env.projectId;

// You need a dedicated long code in order to use two-way SMS.
// See: https://docs.aws.amazon.com/pinpoint/latest/userguide/channels-voice-manage.html#channels-voice-manage-request-phone-numbers
const originationNumber = process.env.originationNumber;

// This message is spread across multiple lines for improved readability.
const message =
  '<speak>' +
  'Bom dia <emphasis>Bidese</emphasis>' +
  "using the <break strength='weak'/>AWS SDK for JavaScript in Node.js. " +
  "<amazon:effect phonation='soft'>Thank you for listening." +
  '</amazon:effect>' +
  'Vai <emphasis>dormir</emphasis>' +
  '</speak>';

const messageType = 'TRANSACTIONAL';

exports.handler = (event) => {
  console.log('Received event:', event);
  validateNumber(event);
};

function validateNumber(event) {
  let destinationNumber = event.destinationNumber;
  if (destinationNumber.length === 10) {
    destinationNumber = `+1${destinationNumber}`;
  }
  const params = {
    NumberValidateRequest: {
      IsoCountryCode: 'US',
      PhoneNumber: destinationNumber,
    },
  };
  pinpoint.phoneNumberValidate(params, (err, data) => {
    if (err) {
      console.log(err, err.stack);
    } else {
      console.log(data);
      // return data;
      if (data.NumberValidateResponse.PhoneTypeCode == 0) {
        createEndpoint(data, event.firstName, event.lastName, event.source);
      } else {
        console.log(
          "Received a phone number that isn't capable of receiving " +
            'SMS messages. No endpoint created.'
        );
      }
    }
  });
}

function createEndpoint(data, firstName, lastName, source) {
  const destinationNumber = data.NumberValidateResponse.CleansedPhoneNumberE164;
  const endpointId =
    data.NumberValidateResponse.CleansedPhoneNumberE164.substring(1);

  const params = {
    ApplicationId: projectId,
    // The Endpoint ID is equal to the cleansed phone number minus the leading
    // plus sign. This makes it easier to easily update the endpoint later.
    EndpointId: endpointId,
    EndpointRequest: {
      ChannelType: 'VOICE',
      Address: destinationNumber,
      // OptOut is set to ALL (that is, endpoint is opted out of all messages)
      // because the recipient hasn't confirmed their subscription at this
      // point. When they confirm, a different Lambda function changes this
      // value to NONE (not opted out).
      OptOut: 'ALL',
      Location: {
        PostalCode: data.NumberValidateResponse.ZipCode,
        City: data.NumberValidateResponse.City,
        Country: data.NumberValidateResponse.CountryCodeIso2,
      },
      Demographic: {
        Timezone: data.NumberValidateResponse.Timezone,
      },
      Attributes: {
        Source: [source],
      },
      User: {
        UserAttributes: {
          FirstName: [firstName],
          LastName: [lastName],
        },
      },
    },
  };
  pinpoint.updateEndpoint(params, (err, data) => {
    if (err) {
      console.log(err, err.stack);
    } else {
      console.log(data);
      // return data;
      sendConfirmation(destinationNumber);
    }
  });
}

function sendConfirmation(destinationNumber) {
  const params = {
    ApplicationId: projectId,
    MessageRequest: {
      Addresses: {
        [destinationNumber]: {
          ChannelType: 'VOICE',
        },
      },
      MessageConfiguration: {
        SMSMessage: {
          Body: message,
          MessageType: messageType,
          OriginationNumber: originationNumber,
        },
      },
    },
  };

  pinpoint.sendMessages(params, (err, data) => {
    // If something goes wrong, print an error message.
    if (err) {
      console.log(err.message);
      // Otherwise, show the unique ID for the message.
    } else {
      console.log(
        `Message sent! ${data.MessageResponse.Result[destinationNumber].StatusMessage}`
      );
    }
  });
}
