// index.js (Final Hybrid Version)

require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const { createClient } = require('@deepgram/sdk');
const fetch = require('node-fetch');
const VoiceResponse = twilio.twiml.VoiceResponse;

// --- 1. Credentials and Clients ---
const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
const twilioClient = twilio(twilioAccountSid, twilioAuthToken);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

// --- 2. App Setup ---
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
const PORT = process.env.PORT || 3000;
const SERVER_BASE_URL = process.env.SERVER_BASE_URL;

// --- 3. State Management ---
const conversationHistories = new Map();

// --- 4. Helper Functions ---
async function transcribeAudio(audioUrl) {
    console.log("1. Fetching audio from secure Twilio URL...");
    const audioResponse = await fetch(audioUrl, {
        headers: { 'Authorization': 'Basic ' + Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString('base64') }
    });
    if (!audioResponse.ok) throw new Error(`Failed to fetch audio. Status: ${audioResponse.status}`);
    const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
    console.log(`   Fetched audio successfully. Now transcribing with Deepgram...`);

    const response = await deepgram.listen.prerecorded.v("1").transcribeFile(
        audioBuffer,
        { model: "nova-2", smart_format: true }
    );
    
    if (response.result && response.result.results && response.result.results.channels[0].alternatives[0]) {
        const transcript = response.result.results.channels[0].alternatives[0].transcript;
        console.log("   Transcription successful:", transcript);
        return transcript;
    } else {
        console.warn("   Transcription result was empty.");
        return "";
    }
}

async function getAgentResponse(text, callSid) {
    console.log("2. Getting agent response from GPT-4o mini...");
    let history = conversationHistories.get(callSid) || [
        { role: 'system', content: 'You are a friendly and helpful voice agent. Keep responses concise.' }
    ];
    history.push({ role: 'user', content: text });
    const chatCompletion = await openai.chat.completions.create({
        messages: history,
        model: "gpt-4o-mini",
    });
    const agentText = chatCompletion.choices[0].message.content;
    history.push({ role: 'assistant', content: agentText });
    conversationHistories.set(callSid, history);
    return agentText;
}

async function generateSpeech(text) {
    console.log("3. Generating speech with Deepgram Aura...");
    const audioFileName = `response_${Date.now()}.mp3`;
    const publicDir = path.join(__dirname, 'public');
    if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);
    const speechFile = path.join(publicDir, audioFileName);
    const response = await deepgram.speak.request({ text }, { model: "aura-asteria-en", encoding: "mp3" });
    const stream = await response.getStream();
    const buffer = await getAudioBuffer(stream);
    await fs.promises.writeFile(speechFile, buffer);
    const publicAudioUrl = `${SERVER_BASE_URL}/${audioFileName}`;
    console.log("   Saved speech to:", publicAudioUrl);
    return publicAudioUrl;
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

// --- 5. Express Routes ---
app.get('/start-call', (req, res) => {
    console.log(`--- Starting a new call using base URL: ${SERVER_BASE_URL} ---`);
    twilioClient.calls.create({
        url: `${SERVER_BASE_URL}/handle-call`,
        to: process.env.YOUR_PHONE_NUMBER,
        from: process.env.TWILIO_PHONE_NUMBER,
        statusCallback: `${SERVER_BASE_URL}/call-status`,
        statusCallbackMethod: 'POST',
        statusCallbackEvent: ['completed', 'failed', 'no-answer']
    })
    .then(call => res.send(`Call initiated! SID: ${call.sid}`))
    .catch(error => {
        console.error("Error starting call:", error);
        res.status(500).send(error);
    });
});

app.all('/handle-call', (req, res) => {
    console.log(`Received a ${req.method} request for /handle-call. Proceeding with greeting.`);
    const twiml = new VoiceResponse();
    twiml.say({ voice: 'alice' }, 'Hello! You are connected to the agent. How can I help?');
    twiml.record({ action: '/process-recording', playBeep: false });
    res.type('text/xml');
    res.send(twiml.toString());
});

app.post('/process-recording', async (req, res) => {
    const twiml = new VoiceResponse();
    const recordingUrl = req.body.RecordingUrl;
    const callSid = req.body.CallSid;
    try {
        const userText = await transcribeAudio(recordingUrl);
        if (userText && userText.trim().length > 0) {
            const agentText = await getAgentResponse(userText, callSid);
            const agentAudioUrl = await generateSpeech(agentText);
            twiml.play(agentAudioUrl);
        } else {
            twiml.say("I didn't catch that, could you say it again?");
        }
    } catch (error) {
        console.error(`[${callSid}] - An error occurred during processing:`, error);
        twiml.say("I seem to be having a system malfunction. Please try again.");
    }
    twiml.record({ action: '/process-recording', playBeep: false });
    res.type('text/xml');
    res.send(twiml.toString());
});

app.post('/call-status', (req, res) => {
    const callSid = req.body.CallSid;
    console.log(`--- Call ${callSid} has ended with status: ${req.body.CallStatus}. Cleaning up history. ---`);
    conversationHistories.delete(callSid);
    res.sendStatus(200);
});

// --- 6. Start the Server ---
app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}.`);
});

