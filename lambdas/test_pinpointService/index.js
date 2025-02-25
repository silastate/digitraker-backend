'use strict';

const AWS = require('aws-sdk');

const awsRegion = 'us-east-1';
const originationNumber = '+19738335877';

// const destinationNumber = "+13343322730"; // Bidese
const destinationNumber = '+491624533572'; // Julio

const languageCode = 'en-US';
const voiceId = 'Matthew';

// Create a new Pinpoint object.
const pinpointsmsvoice = new AWS.PinpointSMSVoice({ region: awsRegion });

// const voiceMessage = "<speak>"
//   + "Hello, an alarm triggered"
//   + "Sensor <emphasis>Kitchen</emphasis>, ID <emphasis>1234567_0</emphasis>,"
//   + "Location <emphasis>Main Floor</emphasis>, Gateway  <emphasis>Auburn</emphasis>,"
//   + "Alarm <emphasis>outRange</emphasis>,"
//   + "Range Min: <emphasis>27°</emphasis>,"
//   + "Range Max: <emphasis>32°</emphasis>,"
//   + "Last Value: <emphasis>35°</emphasis>,"
//   + "</speak>";

const voiceMessage =
  '<speak>' +
  'Hello, this is a message from Digitracker, you have an outRange alarm at the Sensor Kitchen, located at Main Floor.' +
  'You can view the sensor by going to the <break time="0.2s" />' +
  'app' +
  '<break time="0.2s" />' +
  'dot' +
  '<break time="0.2s" />' +
  'digitracker' +
  '<break time="0.2s" />' +
  'dot' +
  '<break time="0.2s" />' +
  'com <break time="0.2s" />' +
  'and check the alarm pending.' +
  '</speak>';

// Try to send the message.
const sendVoiceMessage = (message, number) => {
  console.log('originationNumber', originationNumber);
  console.log('destinationNumber', number);

  const params = {
    Content: {
      SSMLMessage: {
        LanguageCode: languageCode,
        Text: message,
        VoiceId: voiceId,
      },
    },
    DestinationPhoneNumber: number,
    OriginationPhoneNumber: originationNumber,
  };

  pinpointsmsvoice.sendVoiceMessage(params, (err, data) => {
    // If something goes wrong, print an error message.
    if (err) {
      console.log(err.message);
      // Otherwise, show the unique ID for the message.
    } else {
      console.log(`Message sent! Message ID: ${data.MessageId}`);
    }
  });
};

exports.handler = (event) => {
  console.log('Received event:', event);
  sendVoiceMessage(voiceMessage, destinationNumber);
};
