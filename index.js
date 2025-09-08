// index.js (Streaming Version - from YouTube tutorial)

require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const twilio = require('twilio');
const OpenAI = require('openai');
const { createClient } = require('@deepgram/sdk');
const VoiceResponse = twilio.twiml.VoiceResponse;

// --- 1. Credentials and Clients ---
const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
const twilioClient = twilio(twilioAccountSid, twilioAuthToken);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

// --- 2. App and Server Setup ---
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;
const SERVER_BASE_URL = process.env.SERVER_BASE_URL;

// --- 3. The Real-Time Conversation Engine (WebSocket Logic) ---
wss.on('connection', (ws) => {
    console.log('A new Twilio audio stream has connected.');

    const deepgramLive = deepgram.listen.live({
        model: 'nova-2',
        language: 'en-US',
        smart_format: true,
        encoding: 'mulaw',
        sample_rate: 8000,
    });

    let conversationHistory = [{
        role: 'system',
        content: 'You are a funny, slightly sarcastic but friendly voice agent. You love telling jokes. Keep your responses concise and conversational.'
    }];

    deepgramLive.on('open', () => {
        console.log('Deepgram connection opened.');

        deepgramLive.on('transcript', async (data) => {
            const transcript = data.channel.alternatives[0].transcript;
            if (transcript && data.is_final) {
                console.log(`User said: "${transcript}"`);
                conversationHistory.push({ role: 'user', content: transcript });

                const chatCompletion = await openai.chat.completions.create({
                    messages: conversationHistory,
                    model: "gpt-4o-mini",
                });
                const agentResponse = chatCompletion.choices[0].message.content;
                conversationHistory.push({ role: 'assistant', content: agentResponse });
                console.log(`AI said: "${agentResponse}"`);
                
                // Convert AI text to speech and stream back to Twilio
                const audio = await deepgram.speak.request(
                    { text: agentResponse },
                    { model: "aura-asteria-en", encoding: "mulaw", sample_rate: 8000 }
                );
                const stream = await audio.getStream();
                const reader = stream.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    // Create the Twilio media message format
                    const twilioMediaMessage = {
                        event: 'media',
                        streamSid: ws.streamSid, // The unique ID of this call's audio stream
                        media: {
                            payload: Buffer.from(value).toString('base64'),
                        },
                    };
                    ws.send(JSON.stringify(twilioMediaMessage));
                }
            }
        });

        deepgramLive.on('close', () => console.log('Deepgram connection closed.'));
        deepgramLive.on('error', (error) => console.error('Deepgram error:', error));
    });

    ws.on('message', (message) => {
        const twilioMessage = JSON.parse(message);

        if (twilioMessage.event === 'start') {
            ws.streamSid = twilioMessage.start.streamSid;
            console.log(`Twilio stream started with SID: ${ws.streamSid}`);
        }

        if (twilioMessage.event === 'media') {
            // Forward the raw audio from Twilio to Deepgram
            deepgramLive.send(Buffer.from(twilioMessage.media.payload, 'base64'));
        }
    });

    ws.on('close', () => {
        console.log('Twilio stream connection closed.');
        deepgramLive.finish();
    });
});

// --- 4. Express Routes ---

// This is the webhook Twilio will call when someone dials your number
app.post('/twilio-webhook', (req, res) => {
    console.log('--- Received a call on Twilio number. Connecting to WebSocket... ---');
    const response = new VoiceResponse();
    // Instruct Twilio to start a bi-directional audio stream to our WebSocket server
    response.connect().stream({
        url: `${SERVER_BASE_URL.replace(/^http/, 'ws')}/`,
    });
    res.type('text/xml');
    res.send(response.toString());
});

// --- 5. Start the Server ---
server.listen(PORT, () => {
    console.log(`Server and WebSocket are listening on port ${PORT}.`);
});
