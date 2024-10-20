'use strict';
const AWS = require('aws-sdk');
AWS.config.update({ region: 'us-east-2' });
const ses = new AWS.SES({ region: 'us-east-2' });

exports.handler = async (event) => {
    
    const emailList = event.emailList;
    console.log('emailList', JSON.stringify(emailList, null, 2));
    
    let result = []
    try {
        await Promise.all(
            emailList.map(async (email) => {
             const snsData = await await ses.sendEmail(email).promise().catch(
                (err) => {
                    result.push({"ERROR": err})
                })
                result.push(snsData)
            })
          );
    }
    catch(err) {
        console.log('CATCH EMAIL SEND', err);
    }
    
    const response = {
        statusCode: 200,
        body: result
    };
    return response;
};
