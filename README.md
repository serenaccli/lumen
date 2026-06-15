# Lumen

Warm voice-note messaging with account-based history, browser speech-to-text, and DeepSeek-backed language scanning.

## Run locally

For a hackathon demo, judges do not need GitHub Pages. They can clone the repo and run the full local app, including the Node backend.

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env`.
3. Add your API key in `.env`:

```env
DEEPSEEK_API_KEY=your_key_here
DEEPSEEK_MODEL=deepseek-chat
OPENAI_API_KEY=
OPENAI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe
OPENAI_TEXT_MODEL=gpt-5-nano
PORT=5173
HOST=127.0.0.1
DATA_DIR=data
COOKIE_SECURE=false
```

4. Start the app:

```bash
npm run dev
```

5. Open:

```text
http://127.0.0.1:5173/
```

DeepSeek handles transcript scanning and warm replies. Browser speech recognition provides speech-to-text when only a DeepSeek key is configured. If `OPENAI_API_KEY` is also set, the server can use OpenAI transcription for uploaded audio.

## API Key Safety

Do not commit `.env`. It is already listed in `.gitignore`, and API keys should only live in your local `.env` file or a deployment provider's environment variables.

Never paste a real API key into frontend code, `README.md`, screenshots, GitHub commits, or public chat. If a key is exposed, revoke it in the provider dashboard and create a new one.

For judging, either ask judges to add their own key to `.env`, or use a temporary hackathon key and revoke it after the demo.

## GitHub Pages

GitHub Pages alone is not enough for the full app because Lumen needs a backend for accounts, message storage, voice uploads, audio playback, transcription, and analysis. Pages can host only the static frontend.

For a public deployment, use a full-stack host such as Render, Railway, Fly.io, or a separate frontend/backend setup with a real database and cloud audio storage.
