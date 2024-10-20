const axios = require('axios');

exports.handler = async (event) => {
  console.log(event);

  try {
    const body = {
      messages: [
        {
          body: event.message,
          custom_string: 'alarmReference',
          to: event.phoneNumber,
          voice: 'male',
          lang: 'en-us',
          country: 'US',
        },
      ],
    };

    const res = await sendPost(body);
    console.log(res.data);
  } catch (err) {
    console.log(err);
  }

  return {
    statusCode: 200,
  };
};

async function sendPost(body) {
  const url = 'https://rest.clicksend.com/v3/voice/send';
  //const username = 'digitraker@gmail.com';
  //const password = '5F6EF70E-C882-F1B6-55C3-8DDC85DD2209';
  const username = 'sravan.kumar@select1solution.com';
  const password = '657DD35E-2B35-5AC6-1C19-45AF71C51781';

  const params = {
    auth: {
      username,
      password,
    },
  };

  return await axios.post(url, body, params);
}
