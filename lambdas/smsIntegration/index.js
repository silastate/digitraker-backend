'use strict';
const AWS = require('aws-sdk');
AWS.config.update({ region: 'us-east-2' });
const sns = new AWS.SNS({ apiVersion: '2010-03-31' });

exports.handler = async (event) => {
    const smsList = event.smsList;
    console.log('smsList', JSON.stringify(smsList, null, 2));
    
    let result = []
    try {
        await Promise.all(
            smsList.map(async (sms) => {
             const snsData = await sns.publish(sms).promise().catch(
                (err) => {
                    result.push({"ERROR": err})
                })
                result.push(snsData)
            })
          );
    }
    catch(err) {
        console.log('CATCH SMS SEND', err);
    }
    
    const response = {
        statusCode: 200,
        body: result
    };
    return response;
};
