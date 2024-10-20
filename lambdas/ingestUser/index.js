var aws = require('aws-sdk');
var ddb = new aws.DynamoDB({apiVersion: '2012-10-08'});

exports.handler = async (event, context) => {
    
// {
//   version: '1',
//   region: 'us-east-2',
//   userPoolId: 'us-east-2_Ro4GMVZwK',
//   userName: '6838b31c-f227-40bd-85ec-f0f2140d7ee7',
//   callerContext: {
//     awsSdkVersion: 'aws-sdk-unknown-unknown',
//     clientId: '3h7gpop44c2ia0avcuq99g7d58'
//   },
//   triggerSource: 'PreSignUp_SignUp',
//   request: {
//     userAttributes: {
//       'custom:phone': '+19134491945',
//       'custom:firstName': 'Júlio',
//       'custom:clientId': 'OlatheLab',
//       'custom:lastName': 'Locatelli Piva',
//       'custom:role': 'user',
//       email: 'juliolpiva@hotmail.com'
//     },
//     validationData: null
//   },
//   response: {
//     autoConfirmUser: false,
//     autoVerifyEmail: false,
//     autoVerifyPhone: false
//   }
// }
    
    // console.log(event);

    aws.config.update({region: "us-east-2"});

    // If the required parameters are present, proceed
    if (event.userName) {

        // -- Write data to DDB
        let ddbParams = {
            Item: {
                'userId' : {S: event.userName},
                'email': {S: event.request.userAttributes.email},
                'clientId' : {S : event.request.userAttributes["custom:clientId"]},
                'firstName': {S: event.request.userAttributes['custom:firstName']},
                'lastName': {S: event.request.userAttributes['custom:lastName']},
                'phone': {S: event.request.userAttributes['custom:phone']},
                'createdAt': {N: Date.now().toString()},
                'deleted' : {BOOL : false},
                'role' : {S : event.request.userAttributes['custom:role']},
                'visibleFloors' : {SS: ["none"]},

            },
            TableName: "Users"
        };

        // Call DynamoDB
        console.log("DB PARAMS",  ddbParams);
        try {
            await ddb.putItem(ddbParams).promise()
            console.log("User created: Success ", event.request.userAttributes.firstname);
        } catch (err) {
            console.log("Error", err);
        }

        console.log("Success: Everything executed correctly");
        
        
        // Confirm the e-mail after the register
        event.response.autoConfirmUser = true;
        event.response.autoVerifyEmail = true;
        
        context.done(null, event);

    } else {
        // Nothing to do, the user's email ID is unknown
        console.log("Error: Nothing was written to DDB");
        context.done(null, event);
    }
    
};