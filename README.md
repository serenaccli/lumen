# lumen

Warm voice-note messaging with account-based history, browser speech-to-text, and DeepSeek-backed language scanning.

## Run locally

1. Copy `.env.example` to `.env`.
2. Add `DEEPSEEK_API_KEY`.
3. Run:

```bash
npm install
npm run dev
```

DeepSeek handles transcript scanning and warm replies. Browser speech recognition provides speech-to-text when only a DeepSeek key is configured. If `OPENAI_API_KEY` is also set, the server can use OpenAI transcription for uploaded audio.
