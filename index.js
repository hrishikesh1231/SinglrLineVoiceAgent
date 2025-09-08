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
                    // COST SAVING 1: Add a hard limit on the AI's response length
                    maxTokens: 50,
                    messages: [
                        {
                            role: 'system',
                            // COST SAVING 2: A much stricter prompt to enforce brevity
                            content: 'You are an extremely efficient and friendly voice agent. Your primary goal is to answer the user\'s question and end the call as quickly as possible to save costs. Keep all responses under 25 words. Do not ask open-ended questions like "Is there anything else I can help with?". If the user signals the end of the conversation (e.g., says "thank you" or "okay bye"), you must respond with only "You\'re welcome. Goodbye!" and nothing else.'
                        }
                    ]
                },
                voice: {
                    provider: 'openai',
                    voiceId: 'onyx'
                },
                // COST SAVING 3: A shorter, more direct greeting
                firstMessage: 'Hello, Vapi agent speaking. How can I help?'
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

