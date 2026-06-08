import "dotenv/config";
import express from "express";
import multer from "multer";
import OpenAI, { toFile } from "openai";
import { createServer as createViteServer } from "vite";

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const port = Number(process.env.PORT || 5173);
const isProduction = process.env.NODE_ENV === "production";
const transcribeModel = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";
const textModel = process.env.OPENAI_TEXT_MODEL || "gpt-5-nano";

app.use(express.json({ limit: "1mb" }));

app.post("/api/analyze-voice", requireOpenAIKey, upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No audio file was received." });
    }

    const metrics = parseMetrics(req.body.metrics);
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const audioFile = await toFile(req.file.buffer, req.file.originalname || "voice-note.webm", {
      type: req.file.mimetype || "audio/webm",
    });

    const transcription = await client.audio.transcriptions.create({
      file: audioFile,
      model: transcribeModel,
      prompt:
        "This is a warm family voice note. Preserve hesitations, fillers, repeated attempts, and unfinished phrases where possible.",
    });

    const transcript = normalizeTranscript(transcription);
    const deterministic = buildDeterministicAnalysis(transcript, metrics);
    const refined = await refineAnalysis(client, transcript, deterministic);
    const analysis = mergeAnalysis(deterministic, refined);
    const reply = await generateWarmReply(client, transcript, analysis);

    res.json({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      durationMs: metrics.durationMs || 0,
      transcript,
      analysis,
      reply,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "The voice note was saved, but analysis could not finish. Please try again when the connection feels steadier.",
    });
  }
});

if (isProduction) {
  app.use(express.static("dist"));
  app.get(/.*/, (_req, res) => res.sendFile(new URL("./dist/index.html", import.meta.url).pathname));
} else {
  const vite = await createViteServer({
    server: { middlewareMode: true, host: "127.0.0.1" },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

app.listen(port, "127.0.0.1", () => {
  console.log(`Lumen running at http://127.0.0.1:${port}/`);
});

function requireOpenAIKey(_req, res, next) {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({
      error: "OpenAI is not configured yet. Add OPENAI_API_KEY to .env, then restart the dev server.",
    });
  }
  next();
}

function parseMetrics(value) {
  if (!value) return {};
  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return {};
  }
}

function normalizeTranscript(transcription) {
  if (typeof transcription === "string") return transcription.trim();
  return (transcription.text || "").trim();
}

function buildDeterministicAnalysis(transcript, metrics) {
  const lower = transcript.toLowerCase();
  const words = lower.match(/\b[\w']+\b/g) || [];
  const fillerMatches = lower.match(/\b(um|uh|erm|ah|you know)\b/g) || [];
  const repeated = [];

  for (let index = 1; index < words.length; index += 1) {
    if (words[index] === words[index - 1] && words[index].length > 2) {
      repeated.push(words[index]);
    }
  }

  const circumlocutionPatterns = [
    /the thing (you use|for|that)/gi,
    /the one (that|you|from|in)/gi,
    /the (cold|little|big|silver|kitchen) one/gi,
    /what do you call/gi,
    /i mean/gi,
  ];

  const highlights = [];
  circumlocutionPatterns.forEach((pattern) => {
    const matches = transcript.match(pattern) || [];
    highlights.push(...matches);
  });

  const patterns = new Set();
  if ((metrics.pauseMarkers || 0) > 0) patterns.add("pause markers");
  if (fillerMatches.length > 0) patterns.add("filler tokens");
  if (repeated.length > 0) patterns.add("repeated word attempts");
  if (highlights.length > 0) patterns.add("circumlocution");
  if (/\b(it|that|they|this)\b.*\b(one|thing)\b/i.test(transcript)) patterns.add("pronoun substitution");
  if (/\b(no|sorry|i mean|rather)\b/i.test(transcript)) patterns.add("self-correction");

  const pauseMarkers = Number(metrics.pauseMarkers || 0);
  const disfluencyEvents = pauseMarkers + fillerMatches.length + repeated.length + highlights.length;
  const disfluencyRate = words.length ? Number((disfluencyEvents / words.length).toFixed(3)) : 0;
  const flagged = disfluencyEvents >= 2 || disfluencyRate > 0.06;

  return {
    flagged,
    summary: flagged
      ? "A few moments may be worth noticing gently, especially pauses or naming detours."
      : "This note sounds close to the current baseline.",
    patterns: [...patterns],
    highlights: [...new Set(highlights)].slice(0, 6),
    pauseMarkers,
    fillerCount: fillerMatches.length,
    disfluencyRate,
    baselineComparison: disfluencyRate > 0.06 ? "above-baseline" : "within-baseline",
  };
}

async function refineAnalysis(client, transcript, deterministic) {
  const response = await client.responses.create({
    model: textModel,
    input: [
      {
        role: "system",
        content:
          "You analyse voice-note transcripts for possible word-finding patterns. You are not diagnosing. Return only compact JSON.",
      },
      {
        role: "user",
        content: JSON.stringify({
          transcript,
          deterministic,
          instructions:
            "Return JSON with keys summary, patterns, highlights, flagged, baselineComparison. Use gentle, non-diagnostic language. Highlights must be exact transcript substrings.",
        }),
      },
    ],
    max_output_tokens: 500,
  });

  return parseJsonObject(response.output_text);
}

async function generateWarmReply(client, transcript, analysis) {
  const response = await client.responses.create({
    model: textModel,
    input: [
      {
        role: "system",
        content:
          "You are a warm family conversation partner. Reply to the user's voice note in one or two short, natural sentences. Do not mention monitoring, aphasia, analysis, diagnosis, or therapy.",
      },
      {
        role: "user",
        content: JSON.stringify({ transcript, analysisSummary: analysis.summary }),
      },
    ],
    max_output_tokens: 140,
  });

  return response.output_text?.trim() || "I hear you. Thank you for telling me.";
}

function parseJsonObject(text) {
  if (!text) return {};
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1) return {};
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return {};
  }
}

function mergeAnalysis(deterministic, refined) {
  const patterns = [...new Set([...(deterministic.patterns || []), ...(refined.patterns || [])])].filter(Boolean);
  const highlights = [
    ...new Set([...(deterministic.highlights || []), ...(refined.highlights || [])]),
  ].filter(Boolean);

  return {
    flagged: Boolean(refined.flagged ?? deterministic.flagged),
    summary: refined.summary || deterministic.summary,
    patterns,
    highlights: highlights.slice(0, 8),
    pauseMarkers: deterministic.pauseMarkers,
    fillerCount: deterministic.fillerCount,
    disfluencyRate: deterministic.disfluencyRate,
    baselineComparison: refined.baselineComparison || deterministic.baselineComparison,
  };
}
