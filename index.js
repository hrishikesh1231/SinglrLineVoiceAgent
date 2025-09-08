import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import Twilio from "twilio";
import dotenv from "dotenv";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// Twilio setup
const client = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

/**
 * STEP 1 - Handle incoming call
 */
app.post("/voice", (req, res) => {
  const twiml = new Twilio.twiml.VoiceResponse();

  twiml.say("Hey Hrishikesh! I'm your AI voice agent. How are you doing today?");
  twiml.gather({
    input: "speech",
    action: "/handle-call",
    method: "POST",
    timeout: 5,
  });

  res.type("text/xml");
  res.send(twiml.toString());
});

/**
 * STEP 2 - Handle AI conversation
 */
app.post("/handle-call", async (req, res) => {
  const twiml = new Twilio.twiml.VoiceResponse();

  try {
    const recordingUrl = req.body.RecordingUrl;

    if (!recordingUrl) {
      twiml.say("I didn't hear anything. Could you please repeat?");
      twiml.redirect("/voice");
      res.type("text/xml");
      return res.send(twiml.toString());
    }

    // STEP 2.1 - Transcribe audio using Deepgram
    const transcript = await transcribeWithDeepgram(recordingUrl);

    if (!transcript) {
      twiml.say("Sorry, I couldn’t understand you. Could you please repeat?");
      twiml.redirect("/voice");
      res.type("text/xml");
      return res.send(twiml.toString());
    }

    console.log("User said:", transcript);

    // STEP 2.2 - Get AI response
    const aiResponse = await generateAIResponse(transcript);

    twiml.say(aiResponse);

    // Continue the conversation
    twiml.gather({
      input: "speech",
      action: "/handle-call",
      method: "POST",
      timeout: 5,
    });

    res.type("text/xml");
    res.send(twiml.toString());
  } catch (error) {
    console.error("Error in /handle-call:", error);
    twiml.say("Oops! Something went wrong, let's try again.");
    twiml.redirect("/voice");
    res.type("text/xml");
    res.send(twiml.toString());
  }
});

/**
 * STEP 3 - Deepgram Transcription Function
 */
async function transcribeWithDeepgram(audioUrl) {
  try {
    const response = await fetch("https://api.deepgram.com/v1/listen", {
      method: "POST",
      headers: {
        Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: audioUrl }),
    });

    const data = await response.json();
    return data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || null;
  } catch (error) {
    console.error("Deepgram transcription failed:", error);
    return null;
  }
}

/**
 * STEP 4 - AI Response Generator
 */
async function generateAIResponse(query) {
  // Using HuggingFace free model
  const response = await fetch("https://api-inference.huggingface.co/models/facebook/blenderbot-400M-distill", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ inputs: query }),
  });

  const data = await response.json();
  return data?.generated_text || "I'm not sure how to respond to that.";
}

app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
