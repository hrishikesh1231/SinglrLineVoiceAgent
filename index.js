// index.js (Vapi.ai Version)

require('dotenv').config();
const express = require('express');
const axios = require('axios'); // We use axios to make the API call to Vapi

// --- 1. Credentials ---
const vapiApiKey = process.env.VAPI_API_KEY;
const vapiPhoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
const yourPhoneNumber = process.env.YOUR_PHONE_NUMBER;

// --- 2. App Setup ---
const app = express();
const PORT = process.env.PORT || 3000;

// --- 3. Express Routes ---

// The only endpoint we need! This starts the call.
app.get('/start-call', async (req, res) => {
    console.log('--- Received request to start a call via Vapi ---');

    if (!vapiApiKey || !vapiPhoneNumberId || !yourPhoneNumber) {
        console.error('Missing required environment variables.');
        return res.status(500).send('Server configuration error. Missing API keys or phone numbers.');
    }
    
    try {
        // We send a single, simple POST request to Vapi's API to initiate the call.
        // Vapi's platform handles all the complexity internally.
        await axios.post('https://api.vapi.ai/call/phone', {
            phoneNumberId: vapiPhoneNumberId, // The ID of YOUR Twilio number from the Vapi dashboard
            customer: {
                number: yourPhoneNumber, // The number of the person we are calling
            },
            assistant: {
                // This is where we define the AI's brain and voice
                model: {
                    provider: 'openai',
                    model: 'gpt-4o-mini',
                    messages: [
                        {
                            role: 'system',
                            content: 'You are a funny, slightly sarcastic but friendly voice agent. Keep your responses conversational and not too long.'
                        }
                    ]
                },
                // Vapi has its own library of high-quality, low-latency voices.
                voice: 'jennifer-neural', 
                firstMessage: 'Hello! You are connected to the Vapi agent. How can I help you today?'
            }
        }, {
            headers: {
                'Authorization': `Bearer ${vapiApiKey}`
            }
        });

        console.log('Call successfully initiated with Vapi.');
        res.send('Call initiated successfully via Vapi!');

    } catch (error) {
        console.error('Error starting call with Vapi:', error.response ? error.response.data : error.message);
        res.status(500).send('Failed to start call with Vapi.');
    }
});

// --- 4. Start the Server ---
app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}.`);
});

