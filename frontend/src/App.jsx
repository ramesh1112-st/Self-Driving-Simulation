import { useEffect, useMemo, useState } from "react";
import socket from "./socket";
import ControlPanel from "./components/ControlPanel";
import "./App.css";

const defaultTelemetry = {
  object: "No detection",
  action: "AUTO",
  distance: "--",
  status: "Standby",
  speed: 0,
  confidence: "--",
  mode: "AUTO",
};

function formatTime(value) {
  if (!value) return "--";

  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function App() {
  const [telemetry, setTelemetry] = useState(defaultTelemetry);
  const [frame, setFrame] = useState("");
  const [logs, setLogs] = useState([]);
  const [explanation, setExplanation] = useState(null);
  const [connected, setConnected] = useState(socket.connected);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    const handleConnect = () => setConnected(true);
    const handleDisconnect = () => setConnected(false);

    const handleAiData = (msg) => {
      const timestamp = msg.timestamp || new Date().toISOString();
      const nextTelemetry = {
        ...defaultTelemetry,
        ...msg,
        timestamp,
        mode: msg.mode || "AUTO",
      };

      setTelemetry((current) => ({
        ...nextTelemetry,
        mode: msg.mode || current.mode || "AUTO",
      }));
      setLastUpdated(timestamp);
      setLogs((currentLogs) => [nextTelemetry, ...currentLogs].slice(0, 8));
    };

    const handleState = (state) => {
      if (state?.lastDetection) {
        setTelemetry((current) => ({
          ...current,
          ...state.lastDetection,
          mode: state.mode || state.lastDetection.mode || current.mode,
        }));
      } else if (state?.mode) {
        setTelemetry((current) => ({ ...current, mode: state.mode }));
      }

      setLastUpdated(state?.updatedAt || new Date().toISOString());

      if (Array.isArray(state?.logs)) {
        setLogs(state.logs.slice().reverse().slice(0, 8));
      }
    };

    const handleFrame = (frameData) => {
      setFrame(frameData);
      setLastUpdated(new Date().toISOString());
    };

    const handleExplanation = (data) => {
      setExplanation(data);
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("ai_data", handleAiData);
    socket.on("system_state", handleState);
    socket.on("live_stream", handleFrame);
    socket.on("show_explanation", handleExplanation);

    socket.emit("request_state");

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("ai_data", handleAiData);
      socket.off("system_state", handleState);
      socket.off("live_stream", handleFrame);
      socket.off("show_explanation", handleExplanation);
    };
  }, []);

  const riskLevel = useMemo(() => {
    const action = String(telemetry.action || "").toUpperCase();

    if (["STOP", "BRAKE", "EMERGENCY"].includes(action)) return "critical";
    if (["SLOW", "LEFT", "RIGHT"].includes(action)) return "warning";
    return "normal";
  }, [telemetry.action]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Real-time autonomous vehicle project</p>
          <h1>Self Driving Control Room</h1>
        </div>

        <div className={`connection-pill ${connected ? "online" : "offline"}`}>
          <span />
          {connected ? "Live backend connected" : "Backend offline"}
        </div>
      </header>

      <section className="dashboard-grid">
        <div className="camera-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Camera stream</p>
              <h2>Front road view</h2>
            </div>
            <p className="timestamp">Updated {formatTime(lastUpdated)}</p>
          </div>

          <div className="video-wrapper">
            {frame ? (
              <img src={frame} alt="Live annotated road feed" className="video-feed" />
            ) : (
              <div className="empty-feed">
                <strong>Waiting for camera frames</strong>
                <span>Start the AI camera process to stream annotated video.</span>
              </div>
            )}
          </div>
        </div>

        <aside className={`decision-panel ${riskLevel}`}>
          <p className="eyebrow">Decision engine</p>
          <h2>{telemetry.action || "AUTO"}</h2>
          <p className="decision-copy">
            {explanation?.explanation ||
              `Vehicle is ${telemetry.status || "waiting"} with current mode ${telemetry.mode || "AUTO"}.`}
          </p>

          <div className="metric-row">
            <span>Detected object</span>
            <strong>{telemetry.object || "No detection"}</strong>
          </div>
          <div className="metric-row">
            <span>Distance</span>
            <strong>{telemetry.distance || "--"}</strong>
          </div>
          <div className="metric-row">
            <span>Confidence</span>
            <strong>{telemetry.confidence || "--"}</strong>
          </div>
        </aside>

        <section className="telemetry-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Vehicle telemetry</p>
              <h2>Live operating state</h2>
            </div>
          </div>

          <div className="telemetry-grid">
            <article>
              <span>Speed</span>
              <strong>{telemetry.speed ?? 0} km/h</strong>
            </article>
            <article>
              <span>Status</span>
              <strong>{telemetry.status || "Standby"}</strong>
            </article>
            <article>
              <span>Mode</span>
              <strong>{telemetry.mode || "AUTO"}</strong>
            </article>
            <article>
              <span>Backend</span>
              <strong>{connected ? "Online" : "Offline"}</strong>
            </article>
          </div>
        </section>

        <section className="controls-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Manual override</p>
              <h2>Send drive command</h2>
            </div>
          </div>
          <ControlPanel activeCommand={telemetry.mode || telemetry.action} />
        </section>

        <section className="log-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Recent detections</p>
              <h2>Event stream</h2>
            </div>
          </div>

          <div className="log-list">
            {logs.length ? (
              logs.map((log, index) => (
                <article key={`${log.timestamp || index}-${log.object || "object"}`}>
                  <span>{formatTime(log.timestamp || lastUpdated)}</span>
                  <strong>{log.object || "Object"}</strong>
                  <p>
                    {log.distance || "--"} - {log.action || "AUTO"} - {log.status || "Active"}
                  </p>
                </article>
              ))
            ) : (
              <p className="empty-log">No detections received yet.</p>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

export default App;
