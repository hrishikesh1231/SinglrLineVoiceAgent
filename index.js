// index.js (Optimized Free Version)

require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const fetch = require('node-fetch');
const VoiceResponse = twilio.twiml.VoiceResponse;
const fs = require('fs');
const path = require('path');

// --- Credentials and Clients ---
const huggingFaceToken = process.env.HUGGING_FACE_TOKEN;
const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
const twilioClient = twilio(twilioAccountSid, twilioAuthToken);

// --- App Setup ---
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public')); 
const PORT = process.env.PORT || 3000;

// --- OPTIMIZED Hugging Face API Endpoints ---
// These models are smaller and much faster to load on the free tier.
const STT_API_URL = "https://api-inference.huggingface.co/models/openai/whisper-base"; // Smaller, faster Whisper
const LLM_API_URL = "https://api-inference.huggingface.co/models/google/gemma-2b-it";   // A fast, high-quality model from Google
const TTS_API_URL = "https://api-inference.huggingface.co/models/espnet/kan-bayashi_ljspeech_vits";

// --- State Management for Conversation History ---
const conversationHistories = new Map();

// --- API Helper Functions (Adjusted for new models) ---

async function transcribeAudio(audioUrl) {
    console.log("1. Transcribing audio with whisper-base...");
    const audioResponse = await fetch(audioUrl);
    const audioBlob = await audioResponse.blob();
    const response = await fetch(STT_API_URL, {
        headers: { Authorization: `Bearer ${huggingFaceToken}` },
        method: "POST",
        body: audioBlob,
    });
    const result = await response.json();
    if (result.error) throw new Error(result.error);
    console.log("   Transcription result:", result.text);
    return result.text;
}

async function getAgentResponse(text, callSid) {
    console.log("2. Getting agent response with gemma-2b-it...");
    let history = conversationHistories.get(callSid) || [];
    history.push({ role: 'user', content: text });

    // Gemma model uses a specific prompt format
    const prompt = `<start_of_turn>user\nYou are a funny, slightly sarcastic but friendly voice agent. Keep your responses short and conversational. The user just said: ${text}<end_of_turn>\n<start_of_turn>model\n`;

    const response = await fetch(LLM_API_URL, {
        headers: { Authorization: `Bearer ${huggingFaceToken}`, "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({
            inputs: prompt,
            parameters: { max_new_tokens: 75, return_full_text: false }
        }),
    });
    const result = await response.json();
    if (result.error) throw new Error(result.error);
    let agentText = result[0].generated_text.trim() || "I'm not sure what to say.";
    
    history.push({ role: 'assistant', content: agentText });
    conversationHistories.set(callSid, history);
    console.log("   Agent response:", agentText);
    return agentText;
}

async function generateSpeech(text, serverUrl) {
    console.log("3. Generating speech...");
    const audioFileName = `response_${Date.now()}.mp3`;
    const publicDir = path.join(__dirname, 'public');
    if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);
    const speechFile = path.join(publicDir, audioFileName);
    
    const response = await fetch(TTS_API_URL, {
        headers: { Authorization: `Bearer ${huggingFaceToken}`, "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ inputs: text }),
    });
    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`TTS API failed with status ${response.status}: ${errorBody}`);
    }
    const audioBlob = await response.blob();
    const buffer = Buffer.from(await audioBlob.arrayBuffer());
    await fs.promises.writeFile(speechFile, buffer);
    
    const publicAudioUrl = `${serverUrl}/${audioFileName}`;
    console.log("   Saved speech to:", publicAudioUrl);
    return publicAudioUrl;
}

// --- Express Routes ---
app.get('/start-call', (req, res) => {
    const serverUrl = req.protocol + '://' + req.get('host');
    console.log(`--- Starting a new call using base URL: ${serverUrl} ---`);
    twilioClient.calls.create({
        url: `${serverUrl}/handle-call`,
        to: process.env.YOUR_PHONE_NUMBER,
        from: process.env.TWILIO_PHONE_NUMBER
    })
    .then(call => res.send(`Call initiated! SID: ${call.sid}`))
    .catch(error => res.status(500).send(error));
});

app.post('/handle-call', (req, res) => {
    const twiml = new VoiceResponse();
    twiml.say({ voice: 'alice' }, 'Hello there! Connecting to the agent. Please tell me something after the beep.');
    twiml.record({ action: '/process-recording', playBeep: true });
    res.type('text/xml');
    res.send(twiml.toString());
});

app.post('/process-recording', async (req, res) => {
    const twiml = new VoiceResponse();
    const recordingUrl = req.body.RecordingUrl;
    const callSid = req.body.CallSid;
    const serverUrl = req.protocol + '://' + req.get('host');
    try {
        console.log(`[${callSid}] - Step 1: Starting transcription...`);
        const userText = await transcribeAudio(recordingUrl);
        console.log(`[${callSid}] - Step 1 SUCCESS: Transcription received.`);

        if (userText && userText.trim().length > 1) {
            console.log(`[${callSid}] - Step 2: Getting agent response...`);
            const agentText = await getAgentResponse(userText, callSid);
            console.log(`[${callSid}] - Step 2 SUCCESS: Agent response received.`);

            console.log(`[${callSid}] - Step 3: Generating speech...`);
            const agentAudioUrl = await generateSpeech(agentText, serverUrl);
            console.log(`[${callSid}] - Step 3 SUCCESS: Speech generated.`);
            twiml.play(agentAudioUrl);
        } else {
            twiml.say("I didn't quite catch that. Could you say it again?");
        }
    } catch (error) {
        console.error(`[${callSid}] - AN ERROR OCCURRED:`, error);
        twiml.say("I seem to be having a system malfunction. Please try again.");
    }
    twiml.record({ action: '/process-recording', playBeep: false });
    res.type('text/xml');
    res.send(twiml.toString());
});

app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}.`);
});


