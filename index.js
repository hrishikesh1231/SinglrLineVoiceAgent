// index.js (with Deepgram for Low Latency)

require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const { createClient } = require('@deepgram/sdk'); // Import the new Deepgram library
const VoiceResponse = twilio.twiml.VoiceResponse;

// --- 1. Credentials and Clients ---
const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
const twilioClient = twilio(twilioAccountSid, twilioAuthToken);

// Initialize the OpenAI client (for the "brain")
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Initialize the Deepgram client (for the "ears" and "mouth")
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

// --- 2. App Setup ---
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public')); 
const PORT = process.env.PORT || 3000;

// --- 3. State Management (No changes) ---
const conversationHistories = new Map();

// --- 4. UPGRADED & NEW Helper Functions ---

// 1. Transcription with Deepgram (Faster)
async function transcribeAudio(audioUrl) {
    console.log("1. Transcribing audio with Deepgram...");
    try {
        const response = await deepgram.listen.prerecorded.v("1").transcribeUrl(
            { url: audioUrl },
            { model: "nova-2", smart_format: true }
        );
        const transcript = response.result.results.channels[0].alternatives[0].transcript;
        console.log("   Transcription result:", transcript);
        return transcript;
    } catch (error) {
        console.error("DEEPGRAM TRANSCRIPTION ERROR:", error);
        throw error; // Propagate the error to be caught in the main route
    }
}

// 2. Thinking with OpenAI (This function remains the same)
async function getAgentResponse(text, callSid) {
    console.log("2. Getting agent response from GPT-4o mini...");
    let history = conversationHistories.get(callSid) || [
        { role: 'system', content: 'You are a funny, slightly sarcastic but friendly voice agent. Keep your responses short and conversational, suitable for a phone call.' }
    ];
    history.push({ role: 'user', content: text });

    const chatCompletion = await openai.chat.completions.create({
        messages: history,
        model: "gpt-4o-mini",
    });

    const agentText = chatCompletion.choices[0].message.content;
    history.push({ role: 'assistant', content: agentText });
    conversationHistories.set(callSid, history);
    console.log("   Agent response:", agentText);
    return agentText;
}

// 3. Text-to-Speech with Deepgram Aura (Faster)
async function generateSpeech(text, serverUrl) {
    console.log("3. Generating speech with Deepgram Aura...");
    const audioFileName = `response_${Date.now()}.mp3`;
    const publicDir = path.join(__dirname, 'public');
    if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);
    const speechFile = path.join(publicDir, audioFileName);

    try {
        const response = await deepgram.speak.request(
            { text },
            { model: "aura-asteria-en", encoding: "mp3" }
        );
        
        const stream = await response.getStream();
        const buffer = await getAudioBuffer(stream);

        await fs.promises.writeFile(speechFile, buffer);
        const publicAudioUrl = `${serverUrl}/${audioFileName}`;
        console.log("   Saved speech to:", publicAudioUrl);
        return publicAudioUrl;
    } catch (error) {
        console.error("DEEPGRAM TTS ERROR:", error);
        throw error; // Propagate the error
    }
}

// Helper function to handle Deepgram's audio stream
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


// --- 5. Express Routes (No changes needed in their logic) ---
app.get('/start-call', (req, res) => {
    const serverUrl = req.protocol + '://' + req.get('host');
    console.log(`--- Starting a new call using base URL: ${serverUrl} ---`);
    twilioClient.calls.create({
        url: `${serverUrl}/handle-call`,
        to: process.env.YOUR_PHONE_NUMBER,
        from: process.env.TWILIO_PHONE_NUMBER,
        statusCallback: `${serverUrl}/call-status`,
        statusCallbackMethod: 'POST',
        statusCallbackEvent: ['completed'],
    })
    .then(call => res.send(`Call initiated! SID: ${call.sid}`))
    .catch(error => res.status(500).send(error));
});

app.post('/handle-call', (req, res) => {
    const twiml = new VoiceResponse();
    twiml.say({ voice: 'alice' }, 'Hello! You are connected to the upgraded agent. How can I help?');
    twiml.record({ action: '/process-recording', playBeep: false });
    res.type('text/xml');
    res.send(twiml.toString());
});

app.post('/process-recording', async (req, res) => {
    const twiml = new VoiceResponse();
    const recordingUrl = req.body.RecordingUrl;
    const callSid = req.body.CallSid;
    const serverUrl = req.protocol + '://' + req.get('host');
    try {
        const userText = await transcribeAudio(recordingUrl);
        if (userText && userText.trim().length > 1) {
            const agentText = await getAgent_response(userText, callSid);
            const agentAudioUrl = await generateSpeech(agentText, serverUrl);
            twiml.play(agentAudioUrl);
        } else {
            twiml.say("I didn't catch that, could you say it again?");
        }
    } catch (error) {
        console.error("An error occurred during processing:", error);
        twiml.say("I seem to be having a system malfunction. Please try again.");
    }
    twiml.record({ action: '/process-recording', playBeep: false });
    res.type('text/xml');
    res.send(twiml.toString());
});

app.post('/call-status', (req, res) => {
    const callSid = req.body.CallSid;
    console.log(`--- Call ${callSid} has ended. Cleaning up history. ---`);
    conversationHistories.delete(callSid);
    res.sendStatus(200);
});

// --- 6. Start the Server ---
app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}.`);
});

