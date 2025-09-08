// index.js — Real-time AI Voice Agent
require('dotenv').config();
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
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

const SERVER_BASE_URL = process.env.SERVER_BASE_URL;
const PORT = process.env.PORT || 3000;

// --- 2. Express App ---
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// --- 3. Conversation Memory ---
const conversationHistories = new Map();

// --- 4. Start Call API ---
app.get('/start-call', async (req, res) => {
    try {
        const call = await twilioClient.calls.create({
            url: `${SERVER_BASE_URL}/handle-call`,
            to: process.env.YOUR_PHONE_NUMBER,
            from: process.env.TWILIO_PHONE_NUMBER,
            statusCallback: `${SERVER_BASE_URL}/call-status`,
            statusCallbackMethod: 'POST',
            statusCallbackEvent: ['completed', 'failed', 'no-answer']
        });
        res.send(`✅ Call started! SID: ${call.sid}`);
    } catch (err) {
        console.error('❌ Error starting call:', err);
        res.status(500).send(err.message);
    }
});

// --- 5. Twilio Call Entry Point ---
app.post('/handle-call', (req, res) => {
    const twiml = new VoiceResponse();

    // ✅ Enable live media streaming to our WebSocket endpoint
    twiml.start().stream({
        url: `${SERVER_BASE_URL}/media-stream`,
        track: "inbound_track"
    });

    // ✅ Greeting
    twiml.say({ voice: 'Polly.Joanna' }, "Hello Hrishi! I'm your AI assistant. Let's talk live!");

    res.type('text/xml');
    res.send(twiml.toString());
});

// --- 6. Call Status Cleanup ---
app.post('/call-status', (req, res) => {
    const callSid = req.body.CallSid;
    console.log(`📞 Call ${callSid} ended. Cleaning up memory.`);
    conversationHistories.delete(callSid);
    res.sendStatus(200);
});

// --- 7. WebSocket Upgrade for Media Streams ---
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (req, socket, head) => {
    if (req.url === '/media-stream') {
        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, req);
        });
    } else {
        socket.destroy();
    }
});

// --- 8. WebSocket Handler ---
wss.on('connection', async (ws, req) => {
    console.log("🔗 Twilio connected to media stream");

    // --- Connect to Deepgram Live ---
    const dgLive = deepgram.listen.live({
        model: "nova-2",
        encoding: "mulaw",
        sample_rate: 8000,
        interim_results: true
    });

    dgLive.addListener("open", () => console.log("✅ Connected to Deepgram Live"));

    dgLive.addListener("transcriptReceived", async (dgMsg) => {
        const transcript = dgMsg.channel.alternatives[0].transcript;

        if (transcript && transcript.trim() !== "") {
            console.log(`👤 User: ${transcript}`);

            // --- Get AI response from GPT ---
            const agentReply = await getAgentResponse(transcript, "call-1");

            // --- Generate speech from Deepgram ---
            const audioUrl = await generateSpeech(agentReply);

            // --- Send back audio to Twilio instantly ---
            ws.send(JSON.stringify({
                event: 'media',
                media: { payload: audioUrl }
            }));

            console.log(`🤖 Agent: ${agentReply}`);
        }
    });

    ws.on('message', (msg) => {
        const data = JSON.parse(msg);
        if (data.event === "media" && data.media && data.media.payload) {
            // Stream user audio chunks to Deepgram Live
            dgLive.send(data.media.payload);
        }
    });

    ws.on('close', () => {
        console.log("❌ WebSocket closed, stopping Deepgram stream");
        dgLive.finish();
    });
});

// --- 9. GPT Response ---
async function getAgentResponse(userText, callSid) {
    let history = conversationHistories.get(callSid) || [
        { role: 'system', content: 'You are a funny and friendly AI voice agent. Keep responses short and natural.' }
    ];

    history.push({ role: 'user', content: userText });

    const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: history
    });

    const agentText = completion.choices[0].message.content;
    history.push({ role: 'assistant', content: agentText });
    conversationHistories.set(callSid, history);

    return agentText;
}

// --- 10. Deepgram TTS ---
async function generateSpeech(text) {
    const response = await deepgram.speak.request(
        { text },
        { model: "aura-asteria-en", encoding: "mp3" }
    );

    const stream = await response.getStream();
    const buffer = await getAudioBuffer(stream);

    const fileName = `response_${Date.now()}.mp3`;
    const publicDir = path.join(__dirname, 'public');
    if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);

    const speechFile = path.join(publicDir, fileName);
    await fs.promises.writeFile(speechFile, buffer);

    return `${SERVER_BASE_URL}/${fileName}`;
}

async function getAudioBuffer(response) {
    const reader = response.getReader();
    const chunks = [];
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
    }
    return Buffer.concat(chunks);
}

// --- 11. Start Server ---
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
