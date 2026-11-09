import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties } from "react";
import "./App.css";
import Waveform from "./Waveform";

const initialTracks = [
  { id: "vocals", name: "Vocals", icon: "🎤", color: "#b48cff", muted: false, solo: false, audioUrl: "", volume: 100 },
  { id: "drums", name: "Drums", icon: "🥁", color: "#ffad66", muted: false, solo: false, audioUrl: "", volume: 100 },
  { id: "bass", name: "Bass", icon: "🎸", color: "#55c8b0", muted: false, solo: false, audioUrl: "", volume: 100 },
  { id: "other", name: "Other", icon: "🎹", color: "#65a8ff", muted: false, solo: false, audioUrl: "", volume: 100 },
];

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "00:00";
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState("idle");
  const [uploadError, setUploadError] = useState("");
  const [separationStatus, setSeparationStatus] = useState("idle");
  const [separationError, setSeparationError] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [tracks, setTracks] = useState(initialTracks);
  const [storedFilename, setStoredFilename] = useState("");

  const audioRef = useRef<HTMLAudioElement>(null);
  const stemAudioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const [isStemPlaying, setIsStemPlaying] = useState(false);
  const [playbackMode, setPlaybackMode] = useState<"original" | "stems">("original");
  const [stemCurrentTime, setStemCurrentTime] = useState(0);
  const [stemDuration, setStemDuration] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadRequestRef = useRef(0);
  const separationRequestRef = useRef(0);
  const [engineOnline, setEngineOnline] = useState(false);
  const [playerError, setPlayerError] = useState("");

  useEffect(() => {
    let active = true;
    const checkEngine = async () => {
      try {
        const response = await fetch("http://localhost:8001/docs", { method: "GET" });
        if (active) setEngineOnline(response.ok);
      } catch {
        if (active) setEngineOnline(false);
      }
    };
    void checkEngine();
    const interval = window.setInterval(() => void checkEngine(), 10000);
    return () => { active = false; window.clearInterval(interval); };
  }, []);

  function stemElements() {
    return tracks.map((track) => stemAudioRefs.current[track.id])
      .filter((audio): audio is HTMLAudioElement => Boolean(audio));
  }

  function pauseStems() {
    stemElements().forEach((audio) => audio.pause());
    setIsStemPlaying(false);
  }

  function pauseOriginal() {
    audioRef.current?.pause();
    setPlaying(false);
  }

  async function uploadAudio(selectedFile: File) {
    const requestId = ++uploadRequestRef.current;
    setUploadStatus("uploading");
    setUploadError("");

    const formData = new FormData();
    formData.append("file", selectedFile);

    try {
      const response = await fetch("http://localhost:8001/upload-audio", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.detail || "Audio upload failed.");
      }

      if (requestId !== uploadRequestRef.current) return;
      setUploadStatus("success");
      setStoredFilename(result.stored_filename);
      console.log("Audio uploaded:", result);
    } catch (error) {
      if (requestId !== uploadRequestRef.current) return;
      setUploadStatus("error");
      setUploadError(
        error instanceof Error ? error.message : "Could not connect to the backend."
      );
    }
  }

  async function separateStems() {
    if (!storedFilename) {
      setSeparationError("Please upload an audio file first.");
      return;
    }

    const requestId = ++separationRequestRef.current;
    pauseStems();
    setStemCurrentTime(0);
    setStemDuration(0);
    setTracks((previous) => previous.map((track) => ({ ...track, audioUrl: "" })));
    setSeparationStatus("processing");
    setSeparationError("");

    try {
      const response = await fetch(
        `http://localhost:8001/separate/${encodeURIComponent(storedFilename)}`,
        { method: "POST" }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.detail || "Separation failed.");
      }

      if (requestId !== separationRequestRef.current) return;
      const stemUrls: Record<string, string> = {};

      for (const [name, path] of Object.entries(result.stems)) {
        stemUrls[name] = `http://localhost:8001${path}`;
      }

      setTracks((currentTracks) =>
        currentTracks.map((track) => ({
          ...track,
          audioUrl: stemUrls[track.id] || "",
        }))
      );
      setSeparationStatus("success");
    } catch (error) {
      if (requestId !== separationRequestRef.current) return;
      setSeparationStatus("error");
      setSeparationError(
        error instanceof Error ? error.message : "Could not separate audio."
      );
    }
  }

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  function importAudio(event: ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;
    event.target.value = "";
    const supported = /\.(wav|mp3|flac|ogg|m4a|aac)$/i.test(selectedFile.name);
    if (!supported) {
      alert("Please choose a WAV, MP3, FLAC, OGG, M4A or AAC audio file.");
      return;
    }

    pauseOriginal();
    pauseStems();
    ++uploadRequestRef.current;
    ++separationRequestRef.current;
    setStoredFilename("");
    setUploadStatus("idle");
    setUploadError("");
    setSeparationStatus("idle");
    setSeparationError("");
    setPlayerError("");
    setPlaybackMode("original");
    setTracks(initialTracks.map((track) => ({ ...track })));
    stemAudioRefs.current = {};
    setStemCurrentTime(0);
    setStemDuration(0);
    setDuration(0);
    setCurrentTime(0);
    setFile(selectedFile);
    setAudioUrl(URL.createObjectURL(selectedFile));
    void uploadAudio(selectedFile);
  }

  async function togglePlayback() {
    setPlaybackMode("original");
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    setPlayerError("");
    if (!audio.paused) {
      pauseOriginal();
      return;
    }
    pauseStems();
    try {
      await audio.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
      setPlayerError("Could not play the original audio.");
    }
  }

  function seek(value: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = value;
    setCurrentTime(value);
  }

  function seekStems(time: number) {
    stemElements().forEach((audio) => {
      if (audio.readyState >= 1) audio.currentTime = time;
    });
    setStemCurrentTime(time);
  }

  function toggleTrack(id: string, property: "muted" | "solo") {
    setTracks((previous) =>
      previous.map((track) =>
        track.id === id
          ? { ...track, [property]: !track[property] }
          : track
      )
    );
  }

  function changeTrackVolume(id: string, volume: number) {
    setTracks((previous) =>
      previous.map((track) =>
        track.id === id
          ? { ...track, volume }
          : track
      )
    );
  }

  async function toggleStemPlayback() {
    setPlaybackMode("stems");
    setPlayerError("");
    const elements = stemElements();
    if (elements.length !== initialTracks.length) {
      setPlayerError("Separate the audio before playing the stems.");
      return;
    }
    if (elements.some((audio) => audio.readyState < 1)) {
      setPlayerError("Stems are loading. Try again in a moment.");
      return;
    }
    if (isStemPlaying) {
      pauseStems();
      return;
    }
    pauseOriginal();
    const masterTime = stemCurrentTime >= stemDuration - 0.1 ? 0 : stemCurrentTime;
    elements.forEach((audio) => { audio.currentTime = masterTime; });
    setStemCurrentTime(masterTime);
    try {
      await Promise.all(elements.map((audio) => audio.play()));
      setIsStemPlaying(true);
    } catch {
      elements.forEach((audio) => audio.pause());
      setIsStemPlaying(false);
      setPlayerError("Could not start all stems. Try again after they finish loading.");
    }
  }

  function stopPlayback() {
    if (playbackMode === "stems") {
      pauseStems();
      seekStems(0);
    } else {
      pauseOriginal();
      seek(0);
    }
  }

  function updateStemTime(time: number) {
    setStemCurrentTime(time);
    if (!isStemPlaying) return;
    // Small HTMLAudioElement clock differences can accumulate. Keep tracks aligned.
    for (const audio of stemElements()) {
      if (audio === stemAudioRefs.current.vocals) continue;
      if (Math.abs(audio.currentTime - time) > 0.12 && audio.readyState >= 1) {
        audio.currentTime = time;
      }
    }
  }

  const stemsReady = tracks.every((track) => Boolean(track.audioUrl));
  const isStemsMode = playbackMode === "stems";
  const activeTime = isStemsMode ? stemCurrentTime : currentTime;
  const activeDuration = isStemsMode ? stemDuration : duration;
  const activeProgress = activeDuration > 0 ? Math.min(100, (activeTime / activeDuration) * 100) : 0;
  const hasSolo = tracks.some((track) => track.solo);

  return (
    <main className="studio">
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon">A</div>
          <div>
            <div className="brand-name">AUDIO STUDIO</div>
            <div className="brand-subtitle">AI POWERED WORKSPACE</div>
          </div>
        </div>

        <div className="project-title">
          <span className="status-dot" />
          {file ? file.name : "Untitled Project"}
        </div>

        <div className="topbar-actions">
          <span className="version-label">PREVIEW 0.1</span>
          <button className="button button-primary" onClick={() => fileInputRef.current?.click()}>
            <span>＋</span> Import Audio
          </button>
        </div>
      </header>

      <div className="studio-body">
        <aside className="sidebar">
          <div className="sidebar-section">
            <div className="section-heading">WORKSPACE</div>
            <button className="nav-item active"><span>▦</span> Studio</button>
            <button className="nav-item"><span>♫</span> My Projects</button>
            <button className="nav-item"><span>◷</span> Recent Files</button>
          </div>

          <div className="sidebar-section library-section">
            <div className="section-heading">AUDIO LIBRARY</div>
            {file ? (
              <div className="library-file">
                <span className="file-icon">♫</span>
                <div className="file-details">
                  <strong>{file.name}</strong>
                  <small>{(file.size / (1024 * 1024)).toFixed(1)} MB</small>
                </div>
              </div>
            ) : (
              <div className="empty-library">Your audio files will appear here.</div>
            )}
          </div>

          <div className="sidebar-bottom">
            <div className="engine-status">
              <span className={`status-dot ${engineOnline ? "" : "muted-dot"}`} />
              <div>
                <strong>AI Engine</strong>
                <small>{engineOnline ? "Connected · CPU separation" : "Backend offline"}</small>
              </div>
            </div>
            <div className="sidebar-footer">AI AUDIO STUDIO · 2026</div>
          </div>
        </aside>

        <section className="workspace">
          <div className="workspace-heading">
            <div>
              <div className="eyebrow">YOUR CREATIVE WORKSPACE</div>
              <h1>Audio Studio</h1>
              <p>Import music, separate stems and explore your sound.</p>
            </div>
            <button
              className="button button-outline"
              onClick={() => fileInputRef.current?.click()}
            >
              ＋ Add Track
            </button>
          </div>

          {!file ? (
            <div className="import-panel">
              <div className="upload-symbol">♫</div>
              <h2>Start with your music</h2>
              <p>Import an audio file to begin your project.</p>
              <button className="button button-primary upload-button" onClick={() => fileInputRef.current?.click()}>
                Choose Audio File
              </button>
              <div className="supported-formats">SUPPORTED AUDIO · WAV · MP3 · FLAC · AAC · M4A</div>
            </div>
          ) : (
            <div className="audio-project">
              <div className="source-card">
                <div className="source-art">♫</div>
                <div className="source-info">
                  <span className="eyebrow">SOURCE AUDIO</span>
                  <strong>{file.name}</strong>
                  <small>{formatTime(duration)} · {(file.size / (1024 * 1024)).toFixed(1)} MB</small>
                </div>
                <span className="source-badge">ORIGINAL</span>
                {uploadStatus === "uploading" && (
                  <span className="source-badge">UPLOADING...</span>
                )}

                {uploadStatus === "success" && (
                  <span className="source-badge">UPLOADED ✓</span>
                )}

                {uploadStatus === "error" && (
                  <span className="source-badge" title={uploadError}>
                    UPLOAD FAILED
                  </span>
                )}
              </div>

              <div className="tracks-heading">
                <div>
                  <h2>Stem Tracks</h2>
                  <p>Your separated audio layers will appear here.</p>
                </div>
                <span className="track-count">4 TRACKS</span>
              </div>

              <div className="tracks-list">
                {tracks.map((track) => {
                  const inactive = track.muted || (hasSolo && !track.solo);
                  return (
                    <div className={`track-row ${inactive ? "track-muted" : ""}`} key={track.id}>
                      <div className="track-info">
                        <div className="track-icon" style={{ color: track.color }}>
                          {track.icon}
                        </div>
                        <div className="track-name">
                          <strong>{track.name}</strong>
                          {track.audioUrl ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                              <audio
                                preload="metadata"
                                className="stem-audio"
                                src={track.audioUrl}
                                ref={(element) => {
                                  stemAudioRefs.current[track.id] = element;

                                  if (element) {
                                    element.volume = track.volume / 100;
                                  }
                                }}
                                muted={inactive}
                                onLoadedMetadata={(event) => {
                                  if (track.id === "vocals") {
                                    setStemDuration(event.currentTarget.duration);
                                  }
                                }}
                                onTimeUpdate={(event) => {
                                  if (track.id === "vocals") {
                                    updateStemTime(event.currentTarget.currentTime);
                                  }
                                }}
                                onEnded={() => {
                                  if (track.id === "vocals") {
                                    pauseStems();
                                    setStemCurrentTime(stemDuration);
                                  }
                                }}
                              />
                              <div className="volume-control">
                                <input
                                  type="range"
                                  min="0"
                                  max="100"
                                  value={track.volume}
                                  onChange={(event) =>
                                    changeTrackVolume(track.id, Number(event.target.value))
                                  }
                                  style={{ accentColor: track.color }}
                                />
                                <small>{track.volume}%</small>
                              </div>
                              <a
                                href={track.audioUrl}
                                download={`${track.id}.wav`}
                                style={{ color: track.color, fontSize: "12px" }}
                              >
                                ↓ Download WAV
                              </a>
                            </div>
                          ) : (
                            <small>Awaiting separation</small>
                          )}
                        </div>
                      </div>
                      <Waveform
                        src={track.audioUrl}
                        color={track.color}
                        position={stemCurrentTime}
                        duration={stemDuration}
                        onSeek={(time) => {
                          setPlaybackMode("stems");
                          pauseOriginal();
                          seekStems(time);
                        }}
                      />
                      <div className="track-controls">
                        <button
                          className={track.muted ? "control-active" : ""}
                          title="Mute"
                          onClick={() => toggleTrack(track.id, "muted")}
                        >M</button>
                        <button
                          className={track.solo ? "control-active" : ""}
                          title="Solo"
                          onClick={() => toggleTrack(track.id, "solo")}
                        >S</button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="separation-panel">
                <div>
                  <strong>Ready to separate?</strong>
                  <p>Demucs separates your audio into vocals, drums, bass and other.</p>
                </div>
                <button
                  className="button"
                  onClick={separateStems}
                  disabled={!storedFilename || separationStatus === "processing"}
                >
                  {separationStatus === "processing"
                    ? "Separating..."
                    : separationStatus === "success"
                      ? "✓ Stems Separated"
                      : "✦ Separate Stems"}
                </button>
                {separationStatus === "error" && (
                  <p className="error-message">{separationError}</p>
                )}

                {separationStatus === "success" && (
                  <p>All four stems have been separated successfully!</p>
                )}
              </div>
            </div>
          )}

          <div className="player">
            <div className="player-file">
              <div className="player-icon">♫</div>
              <div>
                <strong>{file ? file.name : "No audio loaded"}</strong>
                <small>{file ? (isStemsMode ? "Stems mix · 4 tracks" : "Original audio") : "Import a file to start listening"}</small>
              </div>
            </div>

            <div className="player-center">
              <div className="transport-buttons">
              <button
                className="play-button"
                onClick={togglePlayback}
                disabled={!audioUrl}
                title="Play original audio"
              >
                {playing ? "Ⅱ" : "▶"}
                <span>Original</span>
              </button>
              <button
                className="play-button"
                onClick={toggleStemPlayback}
                disabled={!stemsReady}
                title="Play all stems together"
              >
                {isStemPlaying ? "Ⅱ" : "▶"}
                <span>Stems</span>
              </button>
                <button className="stop-button" onClick={stopPlayback} disabled={!audioUrl} title="Stop and return to start">■ Stop</button>
                </div>
              <div className="timeline">
                <span>{formatTime(activeTime)}</span>
                <input
                  type="range"
                  aria-label={`Seek ${isStemsMode ? "stems" : "original"} audio`}
                  min="0"
                  max={activeDuration || 1}
                  step="0.1"
                  value={Math.min(activeTime, activeDuration || 1)}
                  onChange={(event) => {
                    const time = Number(event.target.value);
                    if (isStemsMode) seekStems(time);
                    else seek(time);
                  }}
                  style={{ "--progress": `${activeProgress}%` } as CSSProperties}
                  disabled={isStemsMode ? !stemsReady : !audioUrl}
                />
                <span>{formatTime(activeDuration)}</span>
              </div>
            </div>

            <div className="player-end">
              <span className="player-quality">{isStemsMode ? "STEMS MIX" : "ORIGINAL"} · LOCAL AUDIO</span>
            </div>
          </div>
          {playerError && <p className="player-error" role="alert">{playerError}</p>}
        </section>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,.wav,.mp3,.flac,.aac,.m4a"
        hidden
        onChange={importAudio}
      />

      <audio
        ref={audioRef}
        src={audioUrl || undefined}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onEnded={() => { setPlaying(false); setCurrentTime(duration); }}
      />
    </main>
  );
}

export default App;