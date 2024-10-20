const AWS = require("aws-sdk");
AWS.config.update({ region: "us-east-2" });

const dynamo = new AWS.DynamoDB({ apiVersion: "2012-08-10" });

exports.handler = async (event) => {
  const timeNow = new Date();
  const floors = event.floors?.length ? event.floors : [];

  const params = {
    Item: {
      clientId: { S: event.clientId },
      name: { S: event.name },
      slug: { S: event.slug },
      floors: { SS: [...floors] },
      createdAt: { N: timeNow.getTime().toString()},
      begin: { S: timeNow.toISOString().substring(0, 10) },
      deleted: { BOOL: false },
    },
    TableName: "Clients",
  };

  // Call DynamoDB
  console.log("Call params", params);
  try {
    await dynamo.putItem(params).promise();

    return {
      statusCode: 200,
      body: JSON.stringify("Client created: Success!"),
    };
  } catch (err) {
    return {
      statusCode: 400,
      body: JSON.stringify("Error", err),
    };
  }
};
