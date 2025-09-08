
require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai'); // Import the official OpenAI library
const VoiceResponse = twilio.twiml.VoiceResponse;

// --- 1. Credentials and Clients ---
const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
const twilioClient = twilio(twilioAccountSid, twilioAuthToken);

// Initialize the OpenAI client with your new API key
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// --- 2. App Setup ---
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public')); 
const PORT = process.env.PORT || 3000;

// --- 3. State Management ---
// This part remains the same, to handle conversation history for each call
const conversationHistories = new Map();

// --- 4. NEW OpenAI-Powered Helper Functions ---

// 1. Speech-to-Text using OpenAI Whisper
async function transcribeAudio(audioUrl) {
    console.log("1. Transcribing audio with OpenAI Whisper...");
    // The OpenAI library needs the raw audio file, so we must fetch it from Twilio's URL first.
    // Twilio protects its recording URLs, so we must authenticate.
    const audioResponse = await fetch(audioUrl, {
        headers: {
            'Authorization': 'Basic ' + Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString('base64')
        }
    });
    const audioBlob = await audioResponse.blob();

    // Now, we send the audio file to OpenAI for transcription
    const transcription = await openai.audio.transcriptions.create({
        file: await OpenAI.toFile(audioBlob, 'audio.wav'), // Convert the audio blob to a file format OpenAI understands
        model: "whisper-1",
    });
    console.log("   Transcription result:", transcription.text);
    return transcription.text;
}

// 2. Language Model Response using OpenAI GPT-4o mini
// In your getAgentResponse function

async function getAgentResponse(text, callSid) {
    console.log("-> Getting agent response from GPT-4o mini...");
    let history = conversationHistories.get(callSid) || [
        { 
            role: 'system', 
            // 1. A more forceful prompt for speed and brevity
            content: 'You are a friendly but extremely brief voice agent. Your goal is speed. Keep all responses under 20 words. Do not use filler phrases.' 
        }
    ];
    history.push({ role: 'user', content: text });

    const chatCompletion = await openai.chat.completions.create({
        messages: history,
        model: "gpt-4o-mini",
        // 2. Add a hard limit on the response length
        max_tokens: 40 
    });

    // ... rest of the function is the same
    const agentText = chatCompletion.choices[0].message.content;
    history.push({ role: 'assistant', content: agentText });
    conversationHistories.set(callSid, history);
    console.log("   Agent response:", agentText);
    return agentText;
}
// 3. Text-to-Speech using OpenAI TTS
async function generateSpeech(text, serverUrl) {
    console.log("3. Generating speech with OpenAI TTS...");
    const audioFileName = `response_${Date.now()}.mp3`;
    const publicDir = path.join(__dirname, 'public');
    if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir);
    }
    const speechFile = path.join(publicDir, audioFileName);

    // Generate the speech audio and get the result as a buffer
    const mp3 = await openai.audio.speech.create({
        model: "tts-1",
        voice: "alloy", // You can try other voices like 'echo', 'fable', 'onyx', 'nova', 'shimmer'
        input: text,
    });
    
    // Write the audio buffer to a file in our 'public' directory
    const buffer = Buffer.from(await mp3.arrayBuffer());
    await fs.promises.writeFile(speechFile, buffer);
    
    // Return the public URL to this new audio file
    const publicAudioUrl = `${serverUrl}/${audioFileName}`;
    console.log("   Saved speech to:", publicAudioUrl);
    return publicAudioUrl;
}

// --- 5. Express Routes (These do not need to change) ---
// The logic of the routes remains the same; they just call our new OpenAI helper functions.
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

app.all('/handle-call', (req, res) => { // CHANGED THIS LINE from app.post to app.all
    console.log(`Received a ${req.method} request for /handle-call`); // Added extra logging for debugging
    const twiml = new VoiceResponse();
    twiml.say({ voice: 'alice' }, 'Hello! You are connected to the OpenAI agent. What would you like to talk about?');
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
            const agentText = await getAgentResponse(userText, callSid);
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