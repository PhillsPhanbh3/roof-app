import { useState, useRef, useCallback, useEffect } from "react";

// ─── Palette ───────────────────────────────────────────────────────────────
const C = {
  bg: "#070B0F",
  panel: "#0C1117",
  panelHover: "#111820",
  border: "#1C2630",
  borderBright: "#2A3A4A",
  accent: "#00D4FF",
  accentDim: "rgba(0,212,255,0.12)",
  accentGlow: "rgba(0,212,255,0.25)",
  warn: "#FFB800",
  warnDim: "rgba(255,184,0,0.1)",
  danger: "#FF3B3B",
  dangerDim: "rgba(255,59,59,0.1)",
  ok: "#00E87A",
  okDim: "rgba(0,232,122,0.1)",
  text: "#D4E4F0",
  muted: "#4A6070",
  dim: "#1A2530",
};

const FOCUS_AREAS = [
  { key: "damage_cracks", label: "Damage & Cracks", icon: "⚡" },
  { key: "missing_shingles", label: "Missing Shingles", icon: "🔲" },
  { key: "water_pooling", label: "Water Pooling", icon: "💧" },
  { key: "general_condition", label: "General Condition", icon: "📋" },
];

const inject = (css) => {
  if (typeof document === "undefined") return;
  const el = document.createElement("style");
  el.textContent = css;
  document.head.appendChild(el);
};

inject(`
  @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Exo+2:wght@300;400;600;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: ${C.bg}; }
  ::-webkit-scrollbar { width: 4px; } 
  ::-webkit-scrollbar-track { background: ${C.bg}; }
  ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 2px; }
  .tab-btn { transition: all 0.2s; }
  .tab-btn:hover { background: ${C.panelHover} !important; }
  .tab-btn.active { background: ${C.accentDim} !important; color: ${C.accent} !important; border-color: ${C.accent} !important; }
  .media-card { transition: border-color 0.15s, transform 0.15s; }
  .media-card:hover { border-color: ${C.borderBright} !important; transform: translateY(-1px); }
  .scan-btn { transition: all 0.2s; }
  .scan-btn:not(:disabled):hover { box-shadow: 0 0 24px ${C.accentGlow}; transform: translateY(-1px); }
  @keyframes scanline {
    0% { transform: translateY(-100%); }
    100% { transform: translateY(400%); }
  }
  @keyframes pulse-ring {
    0% { box-shadow: 0 0 0 0 ${C.accentGlow}; }
    70% { box-shadow: 0 0 0 10px rgba(0,212,255,0); }
    100% { box-shadow: 0 0 0 0 rgba(0,212,255,0); }
  }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
  @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
  .fade-in { animation: fadeIn 0.3s ease forwards; }
  .live-dot { animation: blink 1.2s infinite; }
`);

// ─── Helpers ───────────────────────────────────────────────────────────────
const toBase64 = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });

const extractVideoFrame = (file, timeSeconds = 1) =>
  new Promise((res, rej) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    video.src = url;
    video.crossOrigin = "anonymous";
    video.currentTime = timeSeconds;
    video.onseeked = () => {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      canvas.getContext("2d").drawImage(video, 0, 0);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        const reader = new FileReader();
        reader.onload = () => res({ b64: reader.result.split(",")[1], thumb: canvas.toDataURL() });
        reader.readAsDataURL(blob);
      }, "image/jpeg", 0.9);
    };
    video.onerror = rej;
    video.load();
  });

const captureCanvasFrame = (videoEl) => {
  const canvas = document.createElement("canvas");
  canvas.width = videoEl.videoWidth || 640;
  canvas.height = videoEl.videoHeight || 480;
  canvas.getContext("2d").drawImage(videoEl, 0, 0);
  return { b64: canvas.toDataURL("image/jpeg", 0.9).split(",")[1], thumb: canvas.toDataURL("image/jpeg", 0.5) };
};

const scoreColor = (s) => s >= 75 ? C.ok : s >= 45 ? C.warn : C.danger;
const scoreDim = (s) => s >= 75 ? C.okDim : s >= 45 ? C.warnDim : C.dangerDim;
const scoreLabel = (s) => s >= 75 ? "GOOD" : s >= 45 ? "FAIR" : "CRITICAL";

// ─── AI Call ───────────────────────────────────────────────────────────────
async function analyzeRoofImage(b64, mediaType = "image/jpeg") {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
          {
            type: "text",
            text: `You are an expert roofing inspector AI. Analyze this roof image for these specific issues: damage & cracks, missing shingles, water pooling, and overall general condition.

Respond ONLY with valid JSON, no markdown, no preamble:
{
  "conditionScore": <0-100 integer>,
  "focusAreas": {
    "damage_cracks": { "severity": "none"|"minor"|"moderate"|"severe", "detail": "<finding>" },
    "missing_shingles": { "severity": "none"|"minor"|"moderate"|"severe", "detail": "<finding>" },
    "water_pooling": { "severity": "none"|"minor"|"moderate"|"severe", "detail": "<finding>" },
    "general_condition": { "severity": "good"|"fair"|"poor"|"critical", "detail": "<finding>" }
  },
  "summary": "<1-2 sentences overall assessment>",
  "urgency": "none"|"monitor"|"soon"|"immediate",
  "recommendations": ["<action 1>", "<action 2>", "<action 3>"]
}

If the image does not show a roof, return conditionScore 0, all severities "severe"/"critical", and note in summary that no roof was detected.`,
          },
        ],
      }],
    }),
  });
  const data = await res.json();
  const raw = (data.content || []).map((c) => c.text || "").join("");
  const clean = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

// ─── Sub-components ────────────────────────────────────────────────────────
function SeverityBadge({ severity }) {
  const map = {
    none: { color: C.ok, bg: C.okDim, label: "NONE" },
    minor: { color: C.warn, bg: C.warnDim, label: "MINOR" },
    moderate: { color: C.warn, bg: C.warnDim, label: "MODERATE" },
    severe: { color: C.danger, bg: C.dangerDim, label: "SEVERE" },
    good: { color: C.ok, bg: C.okDim, label: "GOOD" },
    fair: { color: C.warn, bg: C.warnDim, label: "FAIR" },
    poor: { color: C.danger, bg: C.dangerDim, label: "POOR" },
    critical: { color: C.danger, bg: C.dangerDim, label: "CRITICAL" },
  };
  const s = map[severity] || map.none;
  return (
    <span style={{ padding: "2px 8px", fontSize: 9, fontFamily: "'Share Tech Mono', monospace", letterSpacing: "0.12em", color: s.color, background: s.bg, border: `1px solid ${s.color}33` }}>
      {s.label}
    </span>
  );
}

function UrgencyBar({ urgency }) {
  const levels = ["none", "monitor", "soon", "immediate"];
  const idx = levels.indexOf(urgency);
  const colors = [C.ok, C.ok, C.warn, C.danger];
  const labels = ["No Action Needed", "Monitor", "Address Soon", "Immediate Action"];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ fontSize: 10, color: C.muted, fontFamily: "'Share Tech Mono'", letterSpacing: "0.1em", flexShrink: 0 }}>URGENCY</span>
      <div style={{ flex: 1, display: "flex", gap: 3 }}>
        {levels.map((l, i) => (
          <div key={l} style={{ flex: 1, height: 4, background: i <= idx ? colors[idx] : C.dim, borderRadius: 1, transition: "background 0.3s" }} />
        ))}
      </div>
      <span style={{ fontSize: 10, color: colors[idx], fontFamily: "'Share Tech Mono'", letterSpacing: "0.08em", flexShrink: 0 }}>{labels[idx]}</span>
    </div>
  );
}

function ResultCard({ result }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="fade-in" style={{ background: C.panel, border: `1px solid ${C.border}`, marginBottom: 12 }}>
      {/* Card header */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", cursor: "pointer", borderBottom: open ? `1px solid ${C.border}` : "none" }}
      >
        {result.thumb && (
          <img src={result.thumb} alt="" style={{ width: 64, height: 46, objectFit: "cover", border: `1px solid ${C.border}`, flexShrink: 0 }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontFamily: "'Share Tech Mono'", color: C.text, letterSpacing: "0.06em", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {result.name}
          </div>
          <div style={{ fontSize: 10, color: C.muted, fontFamily: "'Share Tech Mono'", letterSpacing: "0.04em" }}>{result.source}</div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: scoreColor(result.conditionScore), fontFamily: "'Exo 2'", lineHeight: 1 }}>
            {result.conditionScore}
          </div>
          <div style={{ fontSize: 9, color: scoreColor(result.conditionScore), fontFamily: "'Share Tech Mono'", letterSpacing: "0.15em" }}>
            {scoreLabel(result.conditionScore)}
          </div>
        </div>
        <div style={{ color: C.muted, fontSize: 10, marginLeft: 6 }}>{open ? "▲" : "▼"}</div>
      </div>

      {open && (
        <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Focus areas */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {FOCUS_AREAS.map(({ key, label, icon }) => {
              const fa = result.focusAreas?.[key];
              return (
                <div key={key} style={{ background: C.dim, border: `1px solid ${C.border}`, padding: "10px 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 10, color: C.muted, fontFamily: "'Share Tech Mono'", letterSpacing: "0.08em" }}>{icon} {label}</span>
                    {fa && <SeverityBadge severity={fa.severity} />}
                  </div>
                  <div style={{ fontSize: 11, color: C.text, fontFamily: "'Exo 2'", lineHeight: 1.5, fontWeight: 300 }}>
                    {fa?.detail || "—"}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Urgency */}
          {result.urgency && <UrgencyBar urgency={result.urgency} />}

          {/* Summary */}
          {result.summary && (
            <div style={{ background: C.accentDim, border: `1px solid ${C.accent}22`, padding: "10px 14px", fontSize: 12, color: C.text, fontFamily: "'Exo 2'", lineHeight: 1.6, fontWeight: 300 }}>
              {result.summary}
            </div>
          )}

          {/* Recommendations */}
          {result.recommendations?.length > 0 && (
            <div>
              <div style={{ fontSize: 9, color: C.accent, fontFamily: "'Share Tech Mono'", letterSpacing: "0.18em", marginBottom: 8 }}>RECOMMENDATIONS</div>
              {result.recommendations.map((r, i) => (
                <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, fontSize: 11, color: C.text, fontFamily: "'Exo 2'", fontWeight: 300, lineHeight: 1.5 }}>
                  <span style={{ color: C.accent, flexShrink: 0, fontFamily: "'Share Tech Mono'" }}>→</span>
                  {r}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main App ──────────────────────────────────────────────────────────────
export default function RoofScannerPro() {
  const [tab, setTab] = useState("photo"); // photo | video | live
  const [mediaItems, setMediaItems] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ pct: 0, msg: "" });
  const [results, setResults] = useState([]);
  const [liveStream, setLiveStream] = useState(null);
  const [liveScanning, setLiveScanning] = useState(false);
  const [liveResult, setLiveResult] = useState(null);
  const fileRef = useRef();
  const videoRef = useRef();
  const streamRef = useRef(null);

  // ── Live camera ──────────────────────────────────────────────────────────
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } } });
      streamRef.current = stream;
      setLiveStream(stream);
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch {
      alert("Camera access denied or unavailable.");
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setLiveStream(null);
    setLiveResult(null);
  };

  useEffect(() => {
    if (videoRef.current && liveStream) videoRef.current.srcObject = liveStream;
  }, [liveStream]);

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  const captureAndAnalyze = async () => {
    if (!videoRef.current || liveScanning) return;
    setLiveScanning(true);
    setLiveResult(null);
    try {
      const { b64, thumb } = captureCanvasFrame(videoRef.current);
      const parsed = await analyzeRoofImage(b64);
      setLiveResult({ ...parsed, thumb, name: `Live capture — ${new Date().toLocaleTimeString()}`, source: "LIVE CAMERA" });
    } catch (e) {
      setLiveResult({ conditionScore: 0, summary: `Analysis error: ${e.message}`, focusAreas: {}, recommendations: [], urgency: "monitor", name: "Live capture", source: "LIVE CAMERA" });
    }
    setLiveScanning(false);
  };

  // ── File ingestion ────────────────────────────────────────────────────────
  const addFiles = useCallback((files) => {
    const accepted = Array.from(files).filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
    accepted.forEach((file) => {
      const isVideo = file.type.startsWith("video/");
      const url = URL.createObjectURL(file);
      setMediaItems((prev) => [...prev, { file, url, id: Math.random().toString(36).slice(2), isVideo }]);
    });
  }, []);

  const onDrop = (e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); };

  // ── Scan ─────────────────────────────────────────────────────────────────
  const runScan = async () => {
    if (!mediaItems.length || scanning) return;
    setScanning(true);
    setResults([]);
    const out = [];

    for (let i = 0; i < mediaItems.length; i++) {
      const item = mediaItems[i];
      setProgress({ pct: Math.round((i / mediaItems.length) * 90), msg: `Processing ${i + 1}/${mediaItems.length}: ${item.file.name}` });

      try {
        let b64, thumb, mediaType;
        if (item.isVideo) {
          setProgress((p) => ({ ...p, msg: `Extracting frame from video: ${item.file.name}` }));
          const frame = await extractVideoFrame(item.file, 2);
          b64 = frame.b64;
          thumb = frame.thumb;
          mediaType = "image/jpeg";
        } else {
          b64 = await toBase64(item.file);
          thumb = item.url;
          mediaType = item.file.type || "image/jpeg";
        }

        setProgress((p) => ({ ...p, msg: `Analyzing with AI: ${item.file.name}` }));
        const parsed = await analyzeRoofImage(b64, mediaType);
        out.push({ ...parsed, thumb, name: item.file.name, source: item.isVideo ? "VIDEO FRAME" : "PHOTO", id: item.id });
      } catch (e) {
        out.push({ conditionScore: 0, summary: `Error: ${e.message}`, focusAreas: {}, recommendations: [], urgency: "monitor", thumb: item.url, name: item.file.name, source: "ERROR", id: item.id });
      }
    }

    setProgress({ pct: 100, msg: `Scan complete — ${out.length} item${out.length > 1 ? "s" : ""} analyzed` });
    setResults(out);
    setScanning(false);
  };

  const avgScore = results.length ? Math.round(results.reduce((a, r) => a + r.conditionScore, 0) / results.length) : null;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Exo 2', sans-serif" }}>
      {/* Header */}
      <header style={{ borderBottom: `1px solid ${C.border}`, padding: "16px 24px", display: "flex", alignItems: "center", gap: 14, background: C.panel, position: "sticky", top: 0, zIndex: 100 }}>
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <polygon points="16,2 30,14 30,30 2,30 2,14" fill={C.accentDim} stroke={C.accent} strokeWidth="1.5" />
          <line x1="16" y1="2" x2="16" y2="30" stroke={C.accent} strokeWidth="0.75" strokeDasharray="2,3" />
          <circle cx="16" cy="16" r="3" fill={C.accent} />
        </svg>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: C.text, fontFamily: "'Share Tech Mono'" }}>RoofScan Pro</div>
          <div style={{ fontSize: 9, color: C.muted, letterSpacing: "0.22em", textTransform: "uppercase", fontFamily: "'Share Tech Mono'" }}>AI Inspection System v2</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 16, alignItems: "center" }}>
          {[{ id: "damage_cracks", label: "Damage" }, { id: "missing_shingles", label: "Shingles" }, { id: "water_pooling", label: "Water" }, { id: "general_condition", label: "Condition" }].map((f) => (
            <div key={f.id} style={{ fontSize: 9, color: C.accent, fontFamily: "'Share Tech Mono'", letterSpacing: "0.1em", display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ width: 5, height: 5, background: C.accent, borderRadius: "50%" }} />
              {f.label.toUpperCase()}
            </div>
          ))}
        </div>
      </header>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "28px 20px" }}>
        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 20, border: `1px solid ${C.border}`, padding: 4, background: C.panel, width: "fit-content" }}>
          {[
            { id: "photo", label: "📷  Photos" },
            { id: "video", label: "🎬  Video" },
            { id: "live", label: "📡  Live Camera" },
          ].map((t) => (
            <button
              key={t.id}
              className={`tab-btn ${tab === t.id ? "active" : ""}`}
              onClick={() => { setTab(t.id); setResults([]); setMediaItems([]); stopCamera(); }}
              style={{ padding: "8px 20px", fontSize: 11, fontFamily: "'Share Tech Mono'", letterSpacing: "0.12em", background: "transparent", color: tab === t.id ? C.accent : C.muted, border: `1px solid ${tab === t.id ? C.accent : "transparent"}`, cursor: "pointer" }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── PHOTO / VIDEO tab ── */}
        {(tab === "photo" || tab === "video") && (
          <div>
            {/* Drop zone */}
            <div
              style={{ border: `2px dashed ${dragging ? C.accent : C.border}`, padding: "40px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 12, cursor: "pointer", background: dragging ? C.accentDim : "transparent", transition: "all 0.2s", marginBottom: 16, position: "relative", overflow: "hidden" }}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current.click()}
            >
              {dragging && (
                <div style={{ position: "absolute", inset: 0, background: `linear-gradient(90deg, transparent 0%, ${C.accent}11 50%, transparent 100%)`, animation: "scanline 1s linear infinite" }} />
              )}
              <div style={{ fontSize: 36 }}>{tab === "photo" ? "🛰️" : "🎞️"}</div>
              <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: C.text }}>
                {tab === "photo" ? "Drop Roof Photos" : "Drop Roof Video Files"}
              </div>
              <div style={{ fontSize: 10, color: C.muted, fontFamily: "'Share Tech Mono'", letterSpacing: "0.06em" }}>
                {tab === "photo" ? "JPG · PNG · WEBP · HEIC — drone, aerial, ground-level" : "MP4 · MOV · AVI · MKV — AI will extract & analyze key frames"}
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); fileRef.current.click(); }}
                style={{ marginTop: 8, padding: "8px 22px", background: C.accent, color: C.bg, border: "none", fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", cursor: "pointer", fontFamily: "'Share Tech Mono'" }}
              >
                Browse Files
              </button>
              <input
                ref={fileRef}
                type="file"
                accept={tab === "photo" ? "image/*" : "video/*"}
                multiple
                style={{ display: "none" }}
                onChange={(e) => addFiles(e.target.files)}
              />
            </div>

            {/* Media grid */}
            {mediaItems.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10, marginBottom: 16 }}>
                {mediaItems.map((item) => (
                  <div key={item.id} className="media-card" style={{ border: `1px solid ${C.border}`, background: C.panel, position: "relative", overflow: "hidden" }}>
                    {item.isVideo ? (
                      <video src={item.url} style={{ width: "100%", height: 110, objectFit: "cover", display: "block" }} muted />
                    ) : (
                      <img src={item.url} alt="" style={{ width: "100%", height: 110, objectFit: "cover", display: "block" }} />
                    )}
                    {item.isVideo && (
                      <div style={{ position: "absolute", top: 6, left: 6, background: "rgba(0,0,0,0.7)", padding: "2px 6px", fontSize: 9, fontFamily: "'Share Tech Mono'", color: C.warn, letterSpacing: "0.1em" }}>VIDEO</div>
                    )}
                    <div style={{ padding: "5px 8px", fontSize: 9, color: C.muted, fontFamily: "'Share Tech Mono'", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.file.name}</div>
                    <button
                      onClick={() => setMediaItems((p) => p.filter((x) => x.id !== item.id))}
                      style={{ position: "absolute", top: 4, right: 4, width: 20, height: 20, background: "rgba(0,0,0,0.8)", border: `1px solid ${C.border}`, color: C.text, fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                    >✕</button>
                  </div>
                ))}
              </div>
            )}

            {/* Scan controls */}
            {mediaItems.length > 0 && (
              <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                <button
                  className="scan-btn"
                  onClick={runScan}
                  disabled={scanning}
                  style={{ flex: 1, padding: "13px 0", background: scanning ? C.dim : C.accent, color: scanning ? C.muted : C.bg, border: "none", fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", cursor: scanning ? "not-allowed" : "pointer", fontFamily: "'Share Tech Mono'" }}
                >
                  {scanning ? "◌  Scanning..." : `▶  Analyze ${mediaItems.length} File${mediaItems.length > 1 ? "s" : ""}`}
                </button>
                <button
                  onClick={() => { setMediaItems([]); setResults([]); setProgress({ pct: 0, msg: "" }); }}
                  style={{ padding: "13px 18px", background: "transparent", border: `1px solid ${C.border}`, color: C.muted, fontSize: 10, letterSpacing: "0.15em", cursor: "pointer", fontFamily: "'Share Tech Mono'" }}
                >CLEAR</button>
              </div>
            )}

            {/* Progress */}
            {(scanning || progress.pct === 100) && (
              <div style={{ background: C.panel, border: `1px solid ${C.border}`, padding: "16px 18px", marginBottom: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 9, color: C.muted, fontFamily: "'Share Tech Mono'", letterSpacing: "0.15em" }}>ANALYSIS PROGRESS</span>
                  <span style={{ fontSize: 9, color: C.accent, fontFamily: "'Share Tech Mono'" }}>{progress.pct}%</span>
                </div>
                <div style={{ height: 3, background: C.dim, position: "relative" }}>
                  <div style={{ height: "100%", width: `${progress.pct}%`, background: `linear-gradient(90deg, ${C.accent}, ${C.ok})`, transition: "width 0.4s ease" }} />
                </div>
                <div style={{ marginTop: 8, fontSize: 10, color: C.accent, fontFamily: "'Share Tech Mono'", letterSpacing: "0.06em" }}>{progress.msg}</div>
              </div>
            )}
          </div>
        )}

        {/* ── LIVE CAMERA tab ── */}
        {tab === "live" && (
          <div>
            <div style={{ background: C.panel, border: `1px solid ${C.border}`, overflow: "hidden", marginBottom: 16 }}>
              <div style={{ position: "relative", background: "#000", minHeight: 300, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", maxHeight: 420, display: liveStream ? "block" : "none", objectFit: "cover" }} />
                {!liveStream && (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: 40 }}>
                    <div style={{ fontSize: 48 }}>📡</div>
                    <div style={{ fontSize: 13, color: C.muted, fontFamily: "'Share Tech Mono'", letterSpacing: "0.1em" }}>CAMERA OFFLINE</div>
                    <button onClick={startCamera} style={{ padding: "10px 28px", background: C.accent, color: C.bg, border: "none", fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", cursor: "pointer", fontFamily: "'Share Tech Mono'" }}>
                      CONNECT CAMERA
                    </button>
                  </div>
                )}
                {liveStream && (
                  <div style={{ position: "absolute", top: 10, left: 10, display: "flex", alignItems: "center", gap: 6, background: "rgba(0,0,0,0.7)", padding: "4px 10px" }}>
                    <div className="live-dot" style={{ width: 7, height: 7, borderRadius: "50%", background: C.danger }} />
                    <span style={{ fontSize: 9, color: C.danger, fontFamily: "'Share Tech Mono'", letterSpacing: "0.15em" }}>LIVE</span>
                  </div>
                )}
                {liveScanning && (
                  <div style={{ position: "absolute", inset: 0, background: "rgba(0,212,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                    <div style={{ border: `2px solid ${C.accent}`, width: 120, height: 120, animation: "pulse-ring 1s infinite" }} />
                  </div>
                )}
              </div>
              {liveStream && (
                <div style={{ display: "flex", gap: 10, padding: "12px 14px", borderTop: `1px solid ${C.border}` }}>
                  <button
                    onClick={captureAndAnalyze}
                    disabled={liveScanning}
                    style={{ flex: 1, padding: "11px 0", background: liveScanning ? C.dim : C.accent, color: liveScanning ? C.muted : C.bg, border: "none", fontSize: 11, fontWeight: 700, letterSpacing: "0.18em", cursor: liveScanning ? "not-allowed" : "pointer", fontFamily: "'Share Tech Mono'" }}
                  >
                    {liveScanning ? "◌  ANALYZING..." : "⊙  CAPTURE & ANALYZE"}
                  </button>
                  <button onClick={stopCamera} style={{ padding: "11px 16px", background: "transparent", border: `1px solid ${C.border}`, color: C.muted, fontSize: 10, letterSpacing: "0.12em", cursor: "pointer", fontFamily: "'Share Tech Mono'" }}>STOP</button>
                </div>
              )}
            </div>
            {liveResult && <ResultCard result={liveResult} />}
          </div>
        )}

        {/* ── Results ── */}
        {results.length > 0 && (
          <div className="fade-in">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, paddingBottom: 12, borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 11, fontFamily: "'Share Tech Mono'", letterSpacing: "0.15em", color: C.text }}>
                INSPECTION REPORT — {results.length} ITEM{results.length > 1 ? "S" : ""}
              </div>
              {avgScore !== null && (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 9, color: C.muted, fontFamily: "'Share Tech Mono'", letterSpacing: "0.1em" }}>AVG SCORE</span>
                  <span style={{ fontSize: 20, fontWeight: 700, color: scoreColor(avgScore), fontFamily: "'Exo 2'" }}>{avgScore}</span>
                  <span style={{ fontSize: 9, color: scoreColor(avgScore), fontFamily: "'Share Tech Mono'", letterSpacing: "0.1em", border: `1px solid ${scoreColor(avgScore)}44`, padding: "2px 8px" }}>{scoreLabel(avgScore)}</span>
                </div>
              )}
            </div>
            {results.map((r) => <ResultCard key={r.id} result={r} />)}
          </div>
        )}
      </div>
    </div>
  );
}
