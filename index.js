// index.js

// 1. Import all necessary packages
require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const fetch = require('node-fetch');
const VoiceResponse = twilio.twiml.VoiceResponse;

// 2. Set up your credentials from the .env file
const huggingFaceToken = process.env.HUGGING_FACE_TOKEN;
const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
const twilioClient = twilio(twilioAccountSid, twilioAuthToken);

const app = express();
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

// 3. Create a simple home route
app.get('/', (req, res) => {
    res.send('Voice Agent is running!');
});

// 4. Create an endpoint to start the call
app.get('/start-call', (req, res) => {
    console.log("Starting call...");
    twilioClient.calls.create({
        url: 'YOUR_SERVER_URL/handle-call', // We will replace this URL later
        to: process.env.YOUR_PHONE_NUMBER,
        from: process.env.TWILIO_PHONE_NUMBER
    })
    .then(call => {
        console.log('Call initiated with SID:', call.sid);
        res.send(`Call initiated to ${process.env.YOUR_PHONE_NUMBER}`);
    })
    .catch(error => {
        console.error(error);
        res.status(500).send('Failed to start call.');
    });
});

// 5. Create the main endpoint for Twilio to interact with
app.post('/handle-call', (req, res) => {
    const twiml = new VoiceResponse();

    // Greet the user and start listening
    twiml.say({ voice: 'alice' }, 'Hello! The funny agent is here. Tell me something, and I will try to reply.');
    
    // Record the user's speech and send it to the /process-recording endpoint
    twiml.record({
        action: '/process-recording',
        maxLength: 15, // Max recording length in seconds
        finishOnKey: '#', // Stop recording if user presses #
        playBeep: false
    });

    res.type('text/xml');
    res.send(twiml.toString());
});

// We will add the /process-recording endpoint in a later step

// Start the server
app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});