import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const MAX_RECORDING_MS = 60_000;

const exampleMessages = [
  {
    id: 1,
    sender: "Sarah",
    side: "family",
    kind: "text",
    text: "Morning Mum. Did you sleep alright?",
    time: "8:42 AM",
  },
  {
    id: 2,
    sender: "Margaret",
    side: "patient",
    kind: "voice",
    duration: "0:18",
    time: "8:45 AM",
    transcript:
      "Yes love, I slept well. I wanted to ask if you could bring the thing you use to open the tins, the little silver one.",
    flagged: true,
    analysis: {
      tag: "word-finding difficulty detected",
      timestamp: "Today, 8:45 AM",
      patterns: ["object naming", "function-over-name phrase", "extended pause"],
      pauseMarkers: 4,
      fillerCount: 0,
      disfluencyRate: 0.078,
      baselineComparison: "above-baseline",
      summary: "A few naming detours appeared in this note. It may be worth mentioning gently if it continues.",
      highlights: ["the thing you use to open the tins", "the little silver one"],
    },
  },
  {
    id: 3,
    sender: "Sarah",
    side: "family",
    kind: "text",
    text: "Of course. I’ll bring it with the soup.",
    time: "8:48 AM",
  },
  {
    id: 4,
    sender: "Margaret",
    side: "patient",
    kind: "voice",
    duration: "0:23",
    time: "9:06 AM",
    transcript:
      "And could you phone the, um, you know, the man from next door, Peter. I left his bowl here.",
    flagged: true,
    analysis: {
      tag: "word-finding difficulty detected",
      timestamp: "Today, 9:06 AM",
      patterns: ["person naming", "filler token", "self-correction"],
      pauseMarkers: 3,
      fillerCount: 2,
      disfluencyRate: 0.069,
      baselineComparison: "above-baseline",
      summary: "There were a few pauses and a self-correction around a person’s name.",
      highlights: ["the, um, you know", "Peter"],
    },
  },
  {
    id: 5,
    sender: "Margaret",
    side: "patient",
    kind: "text",
    text: "Thank you sweetheart.",
    time: "9:07 AM",
  },
];

const weeklyTrend = [
  { day: "Mon", value: 2 },
  { day: "Tue", value: 1 },
  { day: "Wed", value: 3 },
  { day: "Thu", value: 2 },
  { day: "Fri", value: 4 },
  { day: "Sat", value: 3 },
  { day: "Sun", value: 5 },
];

function App() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [view, setView] = useState("user");
  const [screen, setScreen] = useState("chat");
  const [selected, setSelected] = useState(exampleMessages.find((message) => message.flagged));
  const exampleFlagged = useMemo(() => exampleMessages.filter((message) => message.flagged), []);

  useEffect(() => {
    apiGet("/api/me")
      .then((payload) => setUser(payload.user))
      .catch(() => setUser(null))
      .finally(() => setBooting(false));
  }, []);

  function switchView(nextView) {
    setView(nextView);
    setScreen("chat");
  }

  function selectDetail(message) {
    setSelected(message);
    setScreen("detail");
  }

  async function logout() {
    await apiPost("/api/logout");
    setUser(null);
    setView("user");
    setScreen("chat");
  }

  function handleAuthed(nextUser) {
    setUser(nextUser);
    setView("user");
    setScreen(nextUser.role === "relative" ? "dashboard" : "chat");
  }

  if (booting) {
    return (
      <main className="app-shell">
        <section className="phone-frame loading-frame">
          <div className="opening-glow" />
          <div className="center-note">Opening Lumen...</div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="phone-frame" aria-label="Lumen mobile app">
        <div className="opening-glow" />
        <header className="app-header">
          <button className="logo-button" onClick={() => setScreen("chat")} aria-label="Go to chat">
            <span className="logo-mark">L</span>
            <span>
              <strong>Lumen</strong>
              <small>Voice care</small>
            </span>
          </button>
          <div className="view-toggle" aria-label="Demo perspective">
            <button className={view === "user" ? "active" : ""} onClick={() => switchView("user")}>
              User
            </button>
            <button className={view === "example" ? "active" : ""} onClick={() => switchView("example")}>
              Example
            </button>
          </div>
          {user && (
            <button className="logout-button" onClick={logout}>
              Log out
            </button>
          )}
        </header>

        <nav className="tabs" aria-label="Primary navigation">
          <button className={screen === "chat" ? "active" : ""} onClick={() => setScreen("chat")}>
            Chat
          </button>
          <button
            className={screen === "dashboard" ? "active" : ""}
            onClick={() => setScreen("dashboard")}
            disabled={view === "user" && (!user || user.role === "older")}
          >
            {view === "user" && user?.role === "relative" ? "Care" : "Dashboard"}
          </button>
          <button className={screen === "settings" ? "active" : ""} onClick={() => setScreen("settings")}>
            Settings
          </button>
        </nav>

        {screen === "chat" && view === "user" && (
          user ? <UserChatScreen user={user} onSelectFlag={selectDetail} /> : <AuthScreen onAuthed={handleAuthed} />
        )}
        {screen === "chat" && view === "example" && (
          <ExampleChatScreen
            messages={exampleMessages}
            onSelect={selectDetail}
          />
        )}
        {screen === "dashboard" && view === "example" && (
          <DashboardScreen
            flaggedMessages={exampleFlagged}
            onSelect={selectDetail}
          />
        )}
        {screen === "dashboard" && view === "user" && user?.role === "relative" && (
          <CareDashboardScreen onSelect={selectDetail} />
        )}
        {screen === "detail" && selected && (
          <DetailScreen
            message={selected}
            onBack={() => setScreen(view === "example" || user?.role === "relative" ? "dashboard" : "chat")}
          />
        )}
        {screen === "settings" && <SettingsScreen user={user} view={view} onLogout={logout} />}
      </section>
    </main>
  );
}

function AuthScreen({ onAuthed }) {
  const [mode, setMode] = useState("register");
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "older" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = await apiPost(mode === "register" ? "/api/register" : "/api/login", form);
      onAuthed(payload.user);
    } catch (apiError) {
      setError(apiError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="screen auth-screen">
      <div className="section-heading">
        <h1>{mode === "register" ? "Create your account" : "Welcome back"}</h1>
        <p>Your messages and scans are saved privately on this Lumen server.</p>
      </div>
      <form className="auth-form" onSubmit={submit}>
        {mode === "register" && (
          <>
            <label>
              <span>Name</span>
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </label>
            <div className="role-picker" aria-label="Account role">
              <button type="button" className={form.role === "older" ? "active" : ""} onClick={() => setForm({ ...form, role: "older" })}>
                Older person
              </button>
              <button type="button" className={form.role === "relative" ? "active" : ""} onClick={() => setForm({ ...form, role: "relative" })}>
                Younger relative
              </button>
            </div>
          </>
        )}
        <label>
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
          />
        </label>
        <label>
          <span>Password</span>
          <input
            type="password"
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
          />
        </label>
        {error && <p className="status-note alert">{error}</p>}
        <button className="primary-action" disabled={busy}>
          {busy ? "Please wait..." : mode === "register" ? "Create account" : "Sign in"}
        </button>
      </form>
      <button className="link-button" onClick={() => setMode(mode === "register" ? "login" : "register")}>
        {mode === "register" ? "I already have an account" : "Create a new account"}
      </button>
    </section>
  );
}

function UserChatScreen({ user, onSelectFlag }) {
  const [contacts, setContacts] = useState([]);
  const [requests, setRequests] = useState([]);
  const [threadTab, setThreadTab] = useState("messages");
  const [selectedContactId, setSelectedContactId] = useState("");
  const [messages, setMessages] = useState([]);
  const [contactEmail, setContactEmail] = useState("");
  const [textDraft, setTextDraft] = useState("");
  const [status, setStatus] = useState("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState("");
  const [liveTranscript, setLiveTranscript] = useState("");
  const mediaRecorderRef = useRef(null);
  const recognitionRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef(null);
  const transcriptRef = useRef("");

  useEffect(() => {
    reloadContacts();
    return () => {
      stopMediaTracks(streamRef.current);
      stopRecognition(recognitionRef.current);
    };
  }, []);

  useEffect(() => {
    if (selectedContactId) {
      reloadMessages(selectedContactId);
    } else {
      setMessages([]);
    }
  }, [selectedContactId]);

  async function reloadContacts() {
    try {
      const payload = await apiGet("/api/contacts");
      const nextContacts = payload.contacts || [];
      setContacts(nextContacts);
      setRequests(payload.requests || []);
      setSelectedContactId((current) => current || nextContacts[0]?.id || "");
    } catch (apiError) {
      setError(apiError.message);
    }
  }

  async function reloadMessages() {
    if (!selectedContactId) return;
    try {
      const payload = await apiGet(`/api/messages?contactId=${encodeURIComponent(selectedContactId)}`);
      setMessages(payload.messages || []);
    } catch (apiError) {
      setError(apiError.message);
    }
  }

  async function addContact(event) {
    event.preventDefault();
    setError("");
    try {
      const payload = await apiPost("/api/contacts", { email: contactEmail });
      const nextContacts = payload.contacts || [];
      setContacts(nextContacts);
      setRequests(payload.requests || []);
      const added = nextContacts.find((contact) => contact.email === contactEmail.trim().toLowerCase());
      setSelectedContactId(added?.id || nextContacts[0]?.id || "");
      setThreadTab(added ? "messages" : "requests");
      setError(payload.notice || "");
      setContactEmail("");
    } catch (apiError) {
      setError(apiError.message);
    }
  }

  async function sendText(event) {
    event.preventDefault();
    const text = textDraft.trim();
    if (!selectedContactId || !text) return;
    setTextDraft("");
    setError("");
    try {
      const payload = await apiPost("/api/messages", { toUserId: selectedContactId, text });
      setMessages((current) => [...current, payload.message]);
    } catch (apiError) {
      setTextDraft(text);
      setError(apiError.message);
    }
  }

  async function acceptRequest(requestId) {
    setError("");
    try {
      const payload = await apiPost(`/api/contacts/${requestId}/accept`, {});
      setContacts(payload.contacts || []);
      setRequests(payload.requests || []);
      const accepted = (payload.contacts || []).find((contact) => contact.contactRecordId === requestId);
      setSelectedContactId(accepted?.id || selectedContactId);
      setThreadTab("messages");
    } catch (apiError) {
      setError(apiError.message);
    }
  }

  async function startRecording() {
    setError("");
    setLiveTranscript("");
    transcriptRef.current = "";
    if (!selectedContactId) {
      setError("Add or choose a relative before sending a voice note.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError("This browser cannot record audio here. Try a recent Chrome, Edge, or Safari build.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType: preferredMimeType() });
      mediaRecorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setElapsedMs(0);
      setStatus("recording");
      startSpeechRecognition();

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stopMediaTracks(streamRef.current);
        streamRef.current = null;
      };
      recorder.start();

      timerRef.current = window.setInterval(() => {
        const elapsed = Date.now() - startedAtRef.current;
        setElapsedMs(elapsed);
        if (elapsed >= MAX_RECORDING_MS) stopRecording();
      }, 250);
    } catch {
      setStatus("idle");
      setError("Microphone access is needed to record a voice note. You can allow it and try again.");
    }
  }

  function startSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      let nextTranscript = "";
      for (let index = 0; index < event.results.length; index += 1) {
        nextTranscript += event.results[index][0].transcript;
      }
      transcriptRef.current = nextTranscript.trim();
      setLiveTranscript(transcriptRef.current);
    };
    recognition.onerror = () => {};
    recognitionRef.current = recognition;
    recognition.start();
  }

  async function stopRecording() {
    if (timerRef.current) window.clearInterval(timerRef.current);
    stopRecognition(recognitionRef.current);
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;

    const stopped = new Promise((resolve) => {
      recorder.addEventListener("stop", resolve, { once: true });
    });
    recorder.stop();
    await stopped;

    const durationMs = Math.min(Date.now() - startedAtRef.current, MAX_RECORDING_MS);
    const audioBlob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
    const audioUrl = URL.createObjectURL(audioBlob);
    const localId = crypto.randomUUID();
    const localMessage = {
      id: localId,
      kind: "voice",
      fromUserId: user.id,
      toUserId: selectedContactId,
      createdAt: new Date().toISOString(),
      durationMs,
      audioUrl,
      status: "processing",
      transcript: transcriptRef.current,
      reply: "",
      analysis: null,
    };

    setMessages((current) => [...current, localMessage]);
    setStatus("processing");
    await analyseVoiceNote(audioBlob, durationMs, localId, transcriptRef.current, selectedContactId);
  }

  async function analyseVoiceNote(audioBlob, durationMs, localId, browserTranscript, toUserId) {
    try {
      const metrics = await estimateAudioMetrics(audioBlob, durationMs);
      const result = await postVoiceAnalysis(audioBlob, { ...metrics, durationMs }, browserTranscript, toUserId);
      setMessages((current) => current.map((message) => (message.id === localId ? result.message : message)));
      setStatus("idle");
      setLiveTranscript("");
    } catch (apiError) {
      setMessages((current) =>
        current.map((message) =>
          message.id === localId
            ? {
                ...message,
                status: "error",
                error: apiError.message || "Analysis could not finish. Please try again.",
              }
            : message,
        ),
      );
      setStatus("idle");
    }
  }

  async function clearHistory() {
    await apiDelete("/api/messages");
    setMessages([]);
    setError("");
  }

  const isRecording = status === "recording";
  const isProcessing = status === "processing";
  const selectedContact = contacts.find((contact) => contact.id === selectedContactId);

  return (
    <section className="screen chat-screen">
      <div className="chat-title user-title">
        <div className="avatar">{selectedContact ? selectedContact.name.slice(0, 1).toUpperCase() : user.name.slice(0, 1).toUpperCase()}</div>
        <div>
          <h1>{selectedContact ? selectedContact.name : "Your relatives"}</h1>
          <p>{roleLabel(user.role)} · {selectedContact ? selectedContact.email : "Add someone to start talking"}</p>
        </div>
      </div>

      <div className="sub-tabs" aria-label="Messaging sections">
        <button className={threadTab === "messages" ? "active" : ""} onClick={() => setThreadTab("messages")}>
          Messages
        </button>
        <button className={threadTab === "requests" ? "active" : ""} onClick={() => setThreadTab("requests")}>
          Requests {requests.length ? `(${requests.length})` : ""}
        </button>
      </div>

      {threadTab === "messages" && (
        <form className="contact-form" onSubmit={addContact}>
          <input
            type="email"
            placeholder={user.role === "older" ? "Younger relative’s email" : "Older person’s email"}
            value={contactEmail}
            onChange={(event) => setContactEmail(event.target.value)}
          />
          <button>Add</button>
        </form>
      )}

      {threadTab === "messages" && contacts.length > 0 && (
        <div className="contact-strip" aria-label="Relatives">
          {contacts.map((contact) => (
            <button
              key={contact.id}
              className={contact.id === selectedContactId ? "active" : ""}
              onClick={() => setSelectedContactId(contact.id)}
            >
              {contact.name}
              {contact.pending ? " · pending" : ""}
            </button>
          ))}
        </div>
      )}

      <div className="thread">
        {threadTab === "requests" && (
          <MessageRequests requests={requests} onAccept={acceptRequest} currentUserRole={user.role} />
        )}

        {threadTab === "messages" && !selectedContact && (
          <article className="empty-state">
            <strong>Choose who you’re talking to.</strong>
            <p>Add a relative by email, or open Requests to accept someone who added you.</p>
          </article>
        )}

        {threadTab === "messages" && selectedContact && messages.length === 0 && (
          <article className="empty-state">
            <strong>A quiet thread.</strong>
            <p>
              Send a text or voice note. Voice notes are scanned gently in the background.
              {selectedContact.pending ? " They will see this thread when they create an account with that email." : ""}
            </p>
          </article>
        )}

        {threadTab === "messages" &&
          messages.map((message, index) => (
            <UserMessage key={message.id} message={message} index={index} currentUser={user} onSelectFlag={onSelectFlag} />
          ))}
      </div>

      {error && <p className="status-note alert">{error}</p>}
      {isRecording && <p className="status-note">Recording {formatDuration(elapsedMs)} of 1:00</p>}
      {isRecording && liveTranscript && <p className="status-note transcript-live">Heard: {liveTranscript}</p>}
      {isProcessing && <p className="status-note">Listening carefully and preparing a reply...</p>}

      {threadTab === "messages" && (
      <form className="composer message-composer" onSubmit={sendText}>
        <button type="button" className="soft-icon" onClick={clearHistory} aria-label="Clear saved messages">
          ×
        </button>
        <input
          className="composer-field text-input"
          value={textDraft}
          onChange={(event) => setTextDraft(event.target.value)}
          placeholder={isRecording ? "Tap Send when you’re ready" : isProcessing ? "Analysing voice note" : "Write a message"}
          disabled={isRecording || isProcessing || !selectedContact}
        />
        <button className="send-text-button" disabled={!textDraft.trim() || isRecording || isProcessing || !selectedContact}>
          Send
        </button>
        <button
          type="button"
          className={`record-button ${isRecording ? "recording" : ""}`}
          onClick={isRecording ? stopRecording : startRecording}
          disabled={isProcessing || !selectedContact}
          aria-label={isRecording ? "Send voice message" : "Record voice message"}
        >
          {isRecording ? "Send" : "Voice"}
        </button>
      </form>
      )}
    </section>
  );
}

function MessageRequests({ requests, onAccept, currentUserRole }) {
  if (!requests.length) {
    return (
      <article className="empty-state">
        <strong>No message requests.</strong>
        <p>Requests from {currentUserRole === "older" ? "younger relatives" : "older family members"} will appear here.</p>
      </article>
    );
  }

  return requests.map((request) => (
    <article className="request-card" key={request.id}>
      <div>
        <strong>{request.contact.name}</strong>
        <p>{request.contact.email}</p>
        <small>
          {request.direction === "incoming"
            ? "Wants to message you. Accept to open the conversation."
            : request.contact.pending
              ? "Invitation sent. They will see it when they create an account."
              : "Request sent. Waiting for them to accept."}
        </small>
      </div>
      {request.direction === "incoming" ? <button onClick={() => onAccept(request.id)}>Accept</button> : <span className="pending-pill">Pending</span>}
    </article>
  ));
}

function UserMessage({ message, index, currentUser, onSelectFlag }) {
  const isMine = message.fromUserId === currentUser.id;
  const canSeeFlag = currentUser.role !== "older";
  const showFlag = canSeeFlag && message.analysis?.flagged;
  if (message.kind === "text") {
    return (
      <article className={`message-row ${isMine ? "mine" : "theirs"}`} style={{ animationDelay: `${120 + index * 80}ms` }}>
        <div className={`bubble text-bubble ${showFlag ? "flagged has-corner-flag" : ""}`}>
          {showFlag && (
            <button className="corner-flag" onClick={() => onSelectFlag(message)} aria-label="Open flagged text analysis">
              <span aria-hidden="true" />
            </button>
          )}
          <p>{message.text}</p>
          {showFlag && <span className="text-flag-label">FLAGGED TEXT</span>}
          <time>{formatTime(message.createdAt)}</time>
        </div>
      </article>
    );
  }

  return (
    <>
      <article className={`message-row ${isMine ? "mine" : "theirs"}`} style={{ animationDelay: `${120 + index * 80}ms` }}>
        <div className={`bubble voice ${message.status === "error" ? "error" : ""}`}>
          <VoicePlayer message={message} />
          <time>{formatTime(message.createdAt)}</time>
          {message.status === "processing" && <p className="mini-copy">Analysing gently...</p>}
          {message.status === "error" && <p className="mini-copy">{message.error}</p>}
        </div>
      </article>

      {message.status === "complete" && (
        <>
          {canSeeFlag && message.analysis?.flagged && (
            <article className={`message-row ${isMine ? "mine" : "theirs"}`}>
              <div className="bubble analysis-bubble flagged">
                <span className="flag-kicker">FLAGGED VOICE NOTE</span>
                <strong>Word-finding pattern detected</strong>
                <p>{message.analysis?.summary}</p>
                <AnalysisSummary analysis={message.analysis} />
                <button className="flag-tag" onClick={() => onSelectFlag(message)}>
                  Open scan detail
                </button>
              </div>
            </article>
          )}
        </>
      )}
    </>
  );
}

function VoicePlayer({ message }) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef(null);
  const canPlay = Boolean(message.audioUrl);

  async function togglePlayback() {
    if (!canPlay || !audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
      return;
    }
    try {
      await audioRef.current.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  }

  return (
    <button
      type="button"
      className={`voice-card ${canPlay ? "" : "unavailable"}`}
      onClick={togglePlayback}
      disabled={!canPlay}
      aria-label={canPlay ? (playing ? "Pause voice message" : "Play voice message") : "Voice playback unavailable"}
    >
      <span className={`play-dot ${playing ? "playing" : ""}`} />
      <Waveform animate={message.status === "processing" || playing} />
      <span className="duration">{canPlay ? formatDuration(message.durationMs) : "No audio"}</span>
      {canPlay && (
        <audio
          ref={audioRef}
          src={message.audioUrl}
          preload="metadata"
          onEnded={() => setPlaying(false)}
          onPause={() => setPlaying(false)}
          hidden
        />
      )}
    </button>
  );
}

function AnalysisSummary({ analysis }) {
  if (!analysis) return null;
  return (
    <div className="analysis-inline">
      <div>
        <span>Pauses</span>
        <strong>{analysis.pauseMarkers}</strong>
      </div>
      <div>
        <span>Fillers</span>
        <strong>{analysis.fillerCount}</strong>
      </div>
      <div>
        <span>Rate</span>
        <strong>{Math.round((analysis.disfluencyRate || 0) * 100)}%</strong>
      </div>
      <div className="pattern-grid compact">
        {(analysis.patterns || []).map((pattern) => (
          <span key={pattern}>{pattern}</span>
        ))}
      </div>
    </div>
  );
}

function ExampleChatScreen({ messages, onSelect }) {
  return (
    <section className="screen chat-screen">
      <div className="chat-title">
        <div className="avatar">M</div>
        <div>
          <h1>Margaret</h1>
          <p>Example family view</p>
        </div>
      </div>

      <div className="thread">
        {messages.map((message, index) => (
          <ExampleMessageBubble key={message.id} message={message} index={index} onSelect={onSelect} />
        ))}
      </div>
    </section>
  );
}

function ExampleMessageBubble({ message, index, onSelect }) {
  const isMine = message.side === "family";
  const familyFlagVisible = message.flagged;
  return (
    <article
      className={`message-row ${isMine ? "mine" : "theirs"}`}
      style={{ animationDelay: `${220 + index * 130}ms` }}
    >
      <div className={`bubble ${message.kind} ${familyFlagVisible ? "flagged" : ""}`}>
        {message.kind === "text" ? (
          <p>{message.text}</p>
        ) : (
          <button
            className="voice-card"
            onClick={() => familyFlagVisible && onSelect(message)}
            aria-label={familyFlagVisible ? "Open flagged voice message detail" : "Voice message"}
          >
            <span className="play-dot" />
            <Waveform animate={false} />
            <span className="duration">{message.duration}</span>
          </button>
        )}
        {familyFlagVisible && (
          <button className="flag-tag" onClick={() => onSelect(message)}>
            FLAGGED: {message.analysis.tag}
          </button>
        )}
        <time>{message.time}</time>
      </div>
    </article>
  );
}

function Waveform({ animate }) {
  const bars = [30, 54, 38, 72, 44, 60, 34, 80, 42, 66, 36, 58, 46, 76, 40, 62, 35, 52];
  return (
    <span className={`waveform ${animate ? "drawing" : ""}`} aria-hidden="true">
      {bars.map((height, index) => (
        <i key={index} style={{ height: `${height}%`, animationDelay: `${index * 45}ms` }} />
      ))}
    </span>
  );
}

function DashboardScreen({ flaggedMessages, onSelect }) {
  return (
    <section className="screen dashboard-screen">
      <div className="section-heading">
        <h1>Example dashboard</h1>
        <p>Noticing changes gently, for conversations with care.</p>
      </div>

      <div className="metric-grid">
        <Metric label="Flagged this week" value="12" tone="amber" />
        <Metric label="Pause markers" value="31" tone="sage" />
        <Metric label="Vs baseline" value="1.7x" tone="rose" />
      </div>

      <section className="panel trend-panel">
        <div className="panel-title">
          <h2>Weekly trend</h2>
          <span>Personal baseline 4.3%</span>
        </div>
        <div className="bar-chart" aria-label="Weekly flagged message bar chart">
          {weeklyTrend.map((bar, index) => (
            <div className="bar-column" key={bar.day}>
              <span className="bar" style={{ "--height": `${bar.value * 18}%`, animationDelay: `${index * 90}ms` }} />
              <small>{bar.day}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="suggestion-card">
        <strong>Worth discussing with your therapist</strong>
        <p>Today’s example notes show more pauses and naming detours than Margaret’s usual pattern.</p>
      </section>

      <section className="flag-list">
        <div className="panel-title">
          <h2>Flagged transcripts</h2>
          <button>Share with speech therapist</button>
        </div>
        {flaggedMessages.map((message) => (
          <button className="flag-list-item" key={message.id} onClick={() => onSelect(message)}>
            <span>
              <em>FLAGGED VOICE NOTE</em>
              <strong>{message.analysis.timestamp}</strong>
              <small>{message.analysis.patterns.join(" · ")}</small>
            </span>
            <b>{Math.round(message.analysis.disfluencyRate * 100)}%</b>
          </button>
        ))}
      </section>
    </section>
  );
}

function CareDashboardScreen({ onSelect }) {
  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiGet("/api/dashboard")
      .then(setDashboard)
      .catch((apiError) => setError(apiError.message));
  }, []);

  const metrics = dashboard?.metrics || {};
  const trend = dashboard?.trend || weeklyTrend.map((bar) => ({ ...bar, value: 0 }));
  const flaggedMessages = dashboard?.flaggedMessages || [];
  const maxTrend = Math.max(1, ...trend.map((bar) => bar.value || 0));

  return (
    <section className="screen dashboard-screen">
      <div className="section-heading">
        <h1>Care dashboard</h1>
        <p>Message patterns shared with you by older family members.</p>
      </div>

      {error && <p className="status-note alert">{error}</p>}

      <div className="metric-grid">
        <Metric label="Flagged this week" value={String(metrics.flaggedCount || 0)} tone="amber" />
        <Metric label="Pause markers" value={String(metrics.pauseMarkers || 0)} tone="sage" />
        <Metric label="Disfluency rate" value={`${Math.round((metrics.disfluencyRate || 0) * 100)}%`} tone="rose" />
      </div>

      <section className="panel trend-panel">
        <div className="panel-title">
          <h2>Weekly trend</h2>
          <span>{metrics.baselineComparison === "above-baseline" ? "Above baseline" : "Within baseline"}</span>
        </div>
        <div className="bar-chart" aria-label="Weekly flagged message bar chart">
          {trend.map((bar, index) => (
            <div className="bar-column" key={`${bar.day}-${index}`}>
              <span className="bar" style={{ "--height": `${Math.max(8, (bar.value / maxTrend) * 100)}%`, animationDelay: `${index * 90}ms` }} />
              <small>{bar.day}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="suggestion-card">
        <strong>{flaggedMessages.length ? "Worth discussing with your therapist" : "Nothing new to discuss right now"}</strong>
        <p>
          {flaggedMessages.length
            ? "A few recent notes include pauses or naming detours. This is a gentle prompt for conversation, not a diagnosis."
            : "When an older family member sends a flagged message, it will appear here quietly."}
        </p>
      </section>

      <section className="flag-list">
        <div className="panel-title">
          <h2>Flagged transcripts</h2>
          <button>Share with speech therapist</button>
        </div>
        {flaggedMessages.length === 0 && (
          <article className="empty-state inline-empty">
            <strong>No flagged messages yet.</strong>
            <p>Keep chatting normally. Lumen will only surface patterns here when there is something worth noticing.</p>
          </article>
        )}
        {flaggedMessages.map((message) => (
          <button className="flag-list-item" key={message.id} onClick={() => onSelect(message)}>
            <span>
              <em>{flagTypeLabel(message)}</em>
              <strong>{message.fromUser?.name || "Family member"} · {formatTime(message.createdAt)}</strong>
              <small>{(message.analysis?.patterns || []).join(" · ") || "word-finding pattern"}</small>
            </span>
            <b>{Math.round((message.analysis?.disfluencyRate || 0) * 100)}%</b>
          </button>
        ))}
      </section>
    </section>
  );
}

function Metric({ label, value, tone }) {
  return (
    <div className={`metric ${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function DetailScreen({ message, onBack }) {
  const analysis = message.analysis || {};
  const timestamp = analysis.timestamp || (message.createdAt ? formatTime(message.createdAt) : message.time || "");
  const messageText = message.transcript || message.text || "";
  return (
    <section className="screen detail-screen">
      <button className="back-button" onClick={onBack}>
        Back
      </button>
      <div className="section-heading">
        <h1>{message.kind === "text" ? "Text message detail" : "Voice note detail"}</h1>
        {analysis.flagged && <span className="detail-flag">FLAGGED ANALYSIS</span>}
        <p>{message.fromUser?.name ? `${message.fromUser.name} · ${timestamp}` : timestamp}</p>
      </div>

      <section className="panel transcript-panel">
        <h2>{message.kind === "text" ? "Message" : "Transcript"}</h2>
        <p>{highlightTranscript(messageText, analysis.highlights)}</p>
      </section>

      <div className="pattern-grid">
        {(analysis.patterns || []).map((pattern) => (
          <span key={pattern}>{pattern}</span>
        ))}
      </div>

      <section className="panel analysis-panel">
        <div>
          <span>Pause markers</span>
          <strong>{analysis.pauseMarkers || 0}</strong>
        </div>
        <div>
          <span>Filler tokens</span>
          <strong>{analysis.fillerCount || 0}</strong>
        </div>
        <div>
          <span>Disfluency rate</span>
          <strong>{Math.round((analysis.disfluencyRate || 0) * 100)}%</strong>
        </div>
        <div>
          <span>Baseline comparison</span>
          <strong>{analysis.baselineComparison || "within-baseline"}</strong>
        </div>
      </section>

      <section className="suggestion-card">
        <strong>Care note</strong>
        <p>{analysis.summary || "This note is available for gentle review."}</p>
      </section>
    </section>
  );
}

function SettingsScreen({ user, view, onLogout }) {
  async function clearHistory() {
    await apiDelete("/api/messages");
  }

  return (
    <section className="screen settings-screen">
      <div className="section-heading">
        <h1>Settings</h1>
        <p>{view === "user" ? "Account and analysis preferences." : "Example visibility and sensitivity."}</p>
      </div>

      <section className="settings-list">
        <label className="setting-row">
          <span>
            <strong>Consent for voice analysis</strong>
            <small>Recordings are analysed when you send them. Message results are saved to your account.</small>
          </span>
          <input type="checkbox" defaultChecked />
        </label>

        {user && (
          <div className="setting-row">
            <span>
              <strong>{user.name}</strong>
              <small>{user.email}</small>
            </span>
            <button className="small-button" onClick={onLogout}>
              Sign out
            </button>
          </div>
        )}

        <div className="setting-row">
          <span>
            <strong>Saved voice notes</strong>
            <small>Clear this account’s saved message history.</small>
          </span>
          <button className="small-button" onClick={clearHistory} disabled={!user}>
            Clear
          </button>
        </div>

        <label className="setting-row vertical">
          <span>
            <strong>Sensitivity threshold</strong>
            <small>Only surface patterns above the usual baseline.</small>
          </span>
          <input type="range" min="1" max="3" step="0.1" defaultValue="1.5" />
          <div className="range-labels">
            <small>Gentle</small>
            <small>Balanced</small>
            <small>Careful</small>
          </div>
        </label>
      </section>
    </section>
  );
}

async function apiGet(path) {
  const response = await fetch(path, { credentials: "same-origin" });
  return parseApiResponse(response);
}

async function apiPost(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: body instanceof FormData ? body : JSON.stringify(body || {}),
  });
  return parseApiResponse(response);
}

async function apiDelete(path) {
  const response = await fetch(path, { method: "DELETE", credentials: "same-origin" });
  return parseApiResponse(response);
}

async function parseApiResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Something went quiet. Please try again.");
  return payload;
}

async function postVoiceAnalysis(audioBlob, metrics, transcript, toUserId) {
  const formData = new FormData();
  formData.append("audio", audioBlob, "voice-note.webm");
  formData.append("metrics", JSON.stringify(metrics));
  formData.append("transcript", transcript || "");
  formData.append("toUserId", toUserId);
  return apiPost("/api/analyze-voice", formData);
}

async function estimateAudioMetrics(audioBlob, durationMs) {
  try {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return { durationMs, pauseMarkers: 0, pauses: [] };
    const audioContext = new AudioContextClass();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const data = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    const frameSize = Math.floor(sampleRate * 0.05);
    const pauses = [];
    let silenceStart = null;

    for (let offset = 0; offset < data.length; offset += frameSize) {
      let sum = 0;
      for (let index = offset; index < Math.min(offset + frameSize, data.length); index += 1) {
        sum += data[index] * data[index];
      }
      const rms = Math.sqrt(sum / frameSize);
      const timeMs = (offset / sampleRate) * 1000;
      if (rms < 0.012) {
        if (silenceStart === null) silenceStart = timeMs;
      } else if (silenceStart !== null) {
        const pauseMs = timeMs - silenceStart;
        if (pauseMs > 500) pauses.push({ startMs: Math.round(silenceStart), durationMs: Math.round(pauseMs) });
        silenceStart = null;
      }
    }

    await audioContext.close();
    return { durationMs, pauseMarkers: pauses.length, pauses: pauses.slice(0, 20) };
  } catch {
    return { durationMs, pauseMarkers: 0, pauses: [] };
  }
}

function highlightTranscript(text, highlights) {
  if (!highlights?.length) return text;
  let remaining = text || "";
  const parts = [];
  highlights.forEach((highlight) => {
    const index = remaining.toLowerCase().indexOf(String(highlight).toLowerCase());
    if (index === -1) return;
    if (index > 0) parts.push(remaining.slice(0, index));
    parts.push(<mark key={`${highlight}-${parts.length}`}>{remaining.slice(index, index + highlight.length)}</mark>);
    remaining = remaining.slice(index + highlight.length);
  });
  parts.push(remaining);
  return parts;
}

function preferredMimeType() {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function stopMediaTracks(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

function stopRecognition(recognition) {
  try {
    recognition?.stop();
  } catch {
    // Recognition may already be stopped.
  }
}

function roleLabel(role) {
  return role === "relative" ? "Younger relative" : "Older person";
}

function flagTypeLabel(message) {
  return message.kind === "text" ? "FLAGGED TEXT" : "FLAGGED VOICE NOTE";
}

function formatDuration(ms = 0) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

createRoot(document.getElementById("root")).render(<App />);
