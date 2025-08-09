const AWS = require('aws-sdk');
const dynamoDb = new AWS.DynamoDB.DocumentClient();

// Constants
const LOG_TABLE_NAME = process.env.LOG_TABLE_NAME || 'applogs'; // DynamoDB table name

exports.handler = async (event) => {
    // Extract log details from the event
    const logDetails = {
        type: event.type || "INFO", // Log type (e.g., INFO, ERROR, DEBUG)
        datetime: new Date().toISOString(), // Current date and time in ISO format
        username: event.username || "SYSTEM", // Username or SYSTEM if not provided
        sourceModule: event.sourceModule || "Unknown", // Source module of the log
        errorDescription: event.errorDescription || "No error description provided" // Error description
    };

    // Create the logid by concatenating type, username, and sourceModule
    const logid = `${logDetails.type}|${logDetails.username}|${logDetails.sourceModule}`;

    try {
        // Create a log entry
        const logEntry = {
            TableName: LOG_TABLE_NAME,
            Item: {
                logid: AWS.util.uuid.v4(), // Concatenated logid as the primary partition key
                ...logDetails // Spread the log details into the item
            }
        };

        // Write the log entry to DynamoDB
        await dynamoDb.put(logEntry).promise();
        console.log(`Log entry successfully written to DynamoDB table: ${LOG_TABLE_NAME}`);

        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Log entry successfully written", logid: logid, tableName: LOG_TABLE_NAME })
        };
    } catch (error) {
        console.error("Error writing to DynamoDB", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Failed to write log entry to DynamoDB", tableName: LOG_TABLE_NAME })
        };
    }
};