// index.js (Streaming Version - Final Fix)

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
    
    let fullAgentResponse = "";

    deepgramLive.on('open', () => {
        console.log('Deepgram connection opened.');

        deepgramLive.on('transcript', async (data) => {
            const transcript = data.channel.alternatives[0].transcript;
            
            if (transcript && data.is_final) {
                console.log(`User said: "${transcript}"`);
                conversationHistory.push({ role: 'user', content: transcript });
                fullAgentResponse = "";

                try {
                    const chatCompletion = await openai.chat.completions.create({
                        messages: conversationHistory,
                        model: "gpt-4o-mini",
                        stream: true,
                    });

                    for await (const chunk of chatCompletion) {
                        const content = chunk.choices[0]?.delta?.content || "";
                        if (content) {
                            deepgramLive.speak(content);
                            fullAgentResponse += content;
                        }
                    }

                    if (fullAgentResponse) {
                        conversationHistory.push({ role: 'assistant', content: fullAgentResponse });
                        console.log(`AI said: "${fullAgentResponse}"`);
                    }

                } catch (error) {
                    console.error('An error occurred during the AI conversation:', error);
                }
            }
        });

        deepgramLive.on('speak', (data) => {
            const twilioMediaMessage = {
                event: 'media',
                streamSid: ws.streamSid,
                media: {
                    payload: Buffer.from(data).toString('base64'),
                },
            };
            ws.send(JSON.stringify(twilioMediaMessage));
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
    console.log('--- Received a call on Twilio number. ---');
    const response = new VoiceResponse();
    
    // THE CRITICAL FIX: Say the greeting first...
    response.say('Hello! You are connected to the funny AI agent. Please start speaking after this message.');
    
    // ...THEN connect to the WebSocket stream.
    console.log('Connecting to WebSocket...');
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

