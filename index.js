// index.js — Real-time AI Voice Agent (Fixed + Replies Instantly)
require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const twilio = require('twilio');
const OpenAI = require('openai');
const { createClient } = require('@deepgram/sdk');

const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
const twilioClient = twilio(twilioAccountSid, twilioAuthToken);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

const SERVER_BASE_URL = process.env.SERVER_BASE_URL;
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.urlencoded({ extended: true }));

const conversationHistories = new Map();

// === 1. Start Call ===
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

// === 2. Handle Incoming Call ===
app.post('/handle-call', (req, res) => {
    const twiml = new twilio.twiml.VoiceResponse();

    // Start live media streaming to WebSocket
    twiml.start().stream({
        url: `${SERVER_BASE_URL}/media-stream`,
        track: 'inbound_track'
    });

    // Greeting message
    twiml.say({ voice: 'Polly.Joanna' }, "Hello Hrishi! I'm your AI assistant. Let's talk live!");

    // Keep call alive
    twiml.pause({ length: 300 });

    res.type('text/xml');
    res.send(twiml.toString());
});

// === 3. Call Status Cleanup ===
app.post('/call-status', (req, res) => {
    const callSid = req.body.CallSid;
    console.log(`📞 Call ${callSid} ended. Cleaning up memory.`);
    conversationHistories.delete(callSid);
    res.sendStatus(200);
});

// === 4. WebSocket Upgrade ===
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

// === 5. WebSocket Handler ===
wss.on('connection', async (ws, req) => {
    console.log("🔗 Twilio connected to media stream");

    // Connect to Deepgram Live
    const dgLive = deepgram.listen.live({
        model: "nova-2",
        encoding: "mulaw",
        sample_rate: 8000,
        interim_results: false
    });

    dgLive.addListener("open", () => console.log("✅ Connected to Deepgram Live"));

    dgLive.addListener("transcriptReceived", async (dgMsg) => {
        const transcript = dgMsg.channel.alternatives[0].transcript;

        if (transcript && transcript.trim() !== "") {
            console.log(`👤 User: ${transcript}`);

            // Get GPT response
            const agentReply = await getAgentResponse(transcript, "call-1");
            console.log(`🤖 Agent: ${agentReply}`);

            // Get PCM audio from Deepgram Aura
            const pcmBuffer = await getPCMBuffer(agentReply);

            // Send base64 PCM directly to Twilio WebSocket
            ws.send(JSON.stringify({
                event: "media",
                media: { payload: pcmBuffer.toString('base64') }
            }));
        }
    });

    ws.on('message', (msg) => {
        const data = JSON.parse(msg);
        if (data.event === "media" && data.media && data.media.payload) {
            dgLive.send(data.media.payload);
        }
    });

    ws.on('close', () => {
        console.log("❌ WebSocket closed, stopping Deepgram stream");
        dgLive.finish();
    });
});

// === 6. GPT Response ===
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

// === 7. Deepgram Aura → PCM Audio ===
async function getPCMBuffer(text) {
    const response = await deepgram.speak.request(
        { text },
        { model: "aura-asteria-en", encoding: "linear16", sample_rate: 8000 }
    );
    return Buffer.from(await response.getStream().arrayBuffer());
}

// === 8. Start Server ===
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
