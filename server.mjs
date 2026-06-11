import "dotenv/config";
import express from "express";
import multer from "multer";
import OpenAI, { toFile } from "openai";
import { createServer as createViteServer } from "vite";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import crypto from "node:crypto";

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const isProduction = process.env.NODE_ENV === "production";
const transcribeModel = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";
const deepseekModel = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
const openaiTextModel = process.env.OPENAI_TEXT_MODEL || "gpt-5-nano";
const dataDir = process.env.DATA_DIR || "data";
const dataPath = `${dataDir}/lumen.json`;

const openaiClient = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;
const deepseekClient = process.env.DEEPSEEK_API_KEY
  ? new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: "https://api.deepseek.com" })
  : null;

app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    transcription: openaiClient ? "openai" : "browser-speech",
    analysis: deepseekClient ? "deepseek" : openaiClient ? "openai" : "heuristic",
  });
});

app.get("/api/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.post("/api/register", async (req, res) => {
  const { name, email, password } = req.body || {};
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!name || !normalizedEmail || !password || String(password).length < 8) {
    return res.status(400).json({ error: "Please enter a name, email, and password of at least 8 characters." });
  }

  const db = await loadDb();
  if (db.users.some((user) => user.email === normalizedEmail)) {
    return res.status(409).json({ error: "An account already exists for that email." });
  }

  const user = {
    id: crypto.randomUUID(),
    name: String(name).trim(),
    email: normalizedEmail,
    password: hashPassword(password),
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  const session = createSession(db, user.id);
  await saveDb(db);
  setSessionCookie(res, session.token);
  res.json({ user: publicUser(user) });
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const db = await loadDb();
  const user = db.users.find((candidate) => candidate.email === normalizedEmail);
  if (!user || !verifyPassword(password, user.password)) {
    return res.status(401).json({ error: "That email and password did not match." });
  }

  const session = createSession(db, user.id);
  await saveDb(db);
  setSessionCookie(res, session.token);
  res.json({ user: publicUser(user) });
});

app.post("/api/logout", requireAuth, async (req, res) => {
  const db = await loadDb();
  db.sessions = db.sessions.filter((session) => session.token !== req.sessionToken);
  await saveDb(db);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/messages", requireAuth, async (req, res) => {
  const db = await loadDb();
  const messages = db.messages
    .filter((message) => message.userId === req.user.id)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  res.json({ messages });
});

app.delete("/api/messages", requireAuth, async (req, res) => {
  const db = await loadDb();
  db.messages = db.messages.filter((message) => message.userId !== req.user.id);
  await saveDb(db);
  res.json({ ok: true });
});

app.post("/api/analyze-voice", requireAuth, upload.single("audio"), async (req, res) => {
  try {
    const metrics = parseMetrics(req.body.metrics);
    const clientTranscript = String(req.body.transcript || "").trim();

    if (!req.file && !clientTranscript) {
      return res.status(400).json({ error: "No audio or browser transcript was received." });
    }

    const transcript = await transcribeVoice(req.file, clientTranscript);
    if (!transcript) {
      return res.status(400).json({
        error:
          "I could not make out a transcript. Try recording in Chrome or Safari with speech recognition enabled, or configure OpenAI transcription.",
      });
    }

    const deterministic = buildDeterministicAnalysis(transcript, metrics);
    const refined = await refineAnalysis(transcript, deterministic);
    const analysis = mergeAnalysis(deterministic, refined);
    const reply = await generateWarmReply(transcript, analysis, req.user);
    const now = new Date().toISOString();
    const message = {
      id: crypto.randomUUID(),
      userId: req.user.id,
      kind: "voice",
      side: "user",
      createdAt: now,
      durationMs: metrics.durationMs || 0,
      transcript,
      analysis,
      reply,
      status: "complete",
    };

    const db = await loadDb();
    db.messages.push(message);
    await saveDb(db);
    res.json(message);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "The voice note was saved locally, but analysis could not finish. Please try again when the connection feels steadier.",
    });
  }
});

if (isProduction) {
  app.use(express.static("dist"));
  app.get(/.*/, (_req, res) => res.sendFile(new URL("./dist/index.html", import.meta.url).pathname));
} else {
  const vite = await createViteServer({
    server: { middlewareMode: true, host },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

app.listen(port, host, () => {
  console.log(`Lumen running at http://${host}:${port}/`);
});

async function transcribeVoice(file, clientTranscript) {
  if (openaiClient && file) {
    const audioFile = await toFile(file.buffer, file.originalname || "voice-note.webm", {
      type: file.mimetype || "audio/webm",
    });
    const transcription = await openaiClient.audio.transcriptions.create({
      file: audioFile,
      model: transcribeModel,
      prompt:
        "This is a warm family voice note. Preserve hesitations, fillers, repeated attempts, and unfinished phrases where possible.",
    });
    return normalizeTranscript(transcription) || clientTranscript;
  }
  return clientTranscript;
}

async function refineAnalysis(transcript, deterministic) {
  const prompt = JSON.stringify({
    transcript,
    deterministic,
    instructions:
      "Return JSON with keys summary, patterns, highlights, flagged, baselineComparison. Use gentle, non-diagnostic language. Highlights must be exact transcript substrings.",
  });

  if (deepseekClient) {
    const response = await deepseekClient.chat.completions.create({
      model: deepseekModel,
      messages: [
        {
          role: "system",
          content:
            "You analyse voice-note transcripts for possible word-finding patterns. You are not diagnosing. Return only compact JSON.",
        },
        { role: "user", content: prompt },
      ],
      stream: false,
    });
    return parseJsonObject(response.choices?.[0]?.message?.content);
  }

  if (openaiClient) {
    const response = await openaiClient.responses.create({
      model: openaiTextModel,
      input: [
        {
          role: "system",
          content:
            "You analyse voice-note transcripts for possible word-finding patterns. You are not diagnosing. Return only compact JSON.",
        },
        { role: "user", content: prompt },
      ],
      max_output_tokens: 500,
    });
    return parseJsonObject(response.output_text);
  }

  return {};
}

async function generateWarmReply(transcript, analysis, user) {
  const prompt = JSON.stringify({ transcript, analysisSummary: analysis.summary, firstName: user.name.split(" ")[0] });

  if (deepseekClient) {
    const response = await deepseekClient.chat.completions.create({
      model: deepseekModel,
      messages: [
        {
          role: "system",
          content:
            "You are a warm family conversation partner. Reply to the user's voice note in one or two short, natural sentences. Do not mention monitoring, aphasia, analysis, diagnosis, or therapy.",
        },
        { role: "user", content: prompt },
      ],
      stream: false,
    });
    return response.choices?.[0]?.message?.content?.trim() || "I hear you. Thank you for telling me.";
  }

  if (openaiClient) {
    const response = await openaiClient.responses.create({
      model: openaiTextModel,
      input: [
        {
          role: "system",
          content:
            "You are a warm family conversation partner. Reply to the user's voice note in one or two short, natural sentences. Do not mention monitoring, aphasia, analysis, diagnosis, or therapy.",
        },
        { role: "user", content: prompt },
      ],
      max_output_tokens: 140,
    });
    return response.output_text?.trim() || "I hear you. Thank you for telling me.";
  }

  return "I hear you. Thank you for telling me.";
}

async function requireAuth(req, res, next) {
  const token = readCookie(req, "lumen_session");
  if (!token) return res.status(401).json({ error: "Please sign in to continue." });
  const db = await loadDb();
  const session = db.sessions.find((candidate) => candidate.token === token && new Date(candidate.expiresAt) > new Date());
  if (!session) {
    clearSessionCookie(res);
    return res.status(401).json({ error: "Please sign in to continue." });
  }
  const user = db.users.find((candidate) => candidate.id === session.userId);
  if (!user) return res.status(401).json({ error: "Please sign in to continue." });
  req.user = user;
  req.sessionToken = token;
  next();
}

async function loadDb() {
  await mkdir(dataDir, { recursive: true });
  if (!existsSync(dataPath)) {
    return { users: [], sessions: [], messages: [] };
  }
  try {
    const raw = await readFile(dataPath, "utf8");
    return { users: [], sessions: [], messages: [], ...JSON.parse(raw) };
  } catch {
    return { users: [], sessions: [], messages: [] };
  }
}

async function saveDb(db) {
  await mkdir(dataDir, { recursive: true });
  const nextDb = {
    ...db,
    sessions: db.sessions.filter((session) => new Date(session.expiresAt) > new Date()),
  };
  await writeFile(dataPath, JSON.stringify(nextDb, null, 2));
}

function createSession(db, userId) {
  const session = {
    token: crypto.randomBytes(32).toString("hex"),
    userId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
  };
  db.sessions.push(session);
  return session;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(String(password), salt, 210_000, 32, "sha256").toString("hex");
  return `pbkdf2_sha256$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [, salt, hash] = String(stored || "").split("$");
  if (!salt || !hash) return false;
  const candidate = crypto.pbkdf2Sync(String(password), salt, 210_000, 32, "sha256").toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(candidate, "hex"));
}

function setSessionCookie(res, token) {
  const secure = process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production";
  res.setHeader(
    "Set-Cookie",
    `lumen_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${secure ? "; Secure" : ""}`,
  );
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "lumen_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
}

function readCookie(req, name) {
  const cookies = String(req.headers.cookie || "").split(";").map((cookie) => cookie.trim());
  const match = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email };
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
