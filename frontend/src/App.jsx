import { useEffect, useMemo, useRef, useState } from "react";
import socket from "./socket";
import ControlPanel from "./components/ControlPanel";
import { createFrameUrl } from "./frameUtils";
import { getMissionSummary } from "./missionUtils";
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

function LoginPage({
  vehicles,
  selectedVehicleId,
  setSelectedVehicleId,
  username,
  setUsername,
  password,
  setPassword,
  authError,
  authPending,
  onSubmit,
}) {
  return (
    <main className="login-shell">
      <section className="login-panel" aria-labelledby="login-title">
        <div>
          <p className="eyebrow">Secure vehicle access</p>
          <h1 id="login-title">Car Login</h1>
          <p className="login-copy">
            Choose the vehicle you want to control and enter its access code.
          </p>
        </div>

        <form className="login-form" onSubmit={onSubmit}>
          <label>
            <span>Vehicle</span>
            <select
              value={selectedVehicleId}
              onChange={(event) => setSelectedVehicleId(event.target.value)}
            >
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Username</span>
            <input
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="admin, driver, or viewer"
            />
          </label>

          <label>
            <span>Password</span>
            <input
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter password"
            />
          </label>

          {authError ? <p className="auth-error">{authError}</p> : null}

          <button type="submit" disabled={authPending}>
            {authPending ? "Checking access..." : "Unlock Control Room"}
          </button>
        </form>

        <p className="login-hint">
          Demo users: admin/admin123, driver/driver123, viewer/viewer123. Admin can
          control every car, driver can control assigned cars, and viewer is read-only.
        </p>
      </section>
    </main>
  );
}

function App() {
  const [telemetry, setTelemetry] = useState(defaultTelemetry);
  const [frame, setFrame] = useState("");
  const [logs, setLogs] = useState([]);
  const [explanation, setExplanation] = useState(null);
  const [connected, setConnected] = useState(socket.connected);
  const [videoMode, setVideoMode] = useState("waiting");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [vehicles, setVehicles] = useState([{ id: "car-01", name: "Car 01" }]);
  const [selectedVehicleId, setSelectedVehicleId] = useState("car-01");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [session, setSession] = useState(null);
  const [authError, setAuthError] = useState("");
  const [authPending, setAuthPending] = useState(false);
  const [commandWarning, setCommandWarning] = useState("");
  const videoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const requestingWebRtcRef = useRef(false);
  const frameRef = useRef("");
  const videoModeRef = useRef("waiting");

  const explanationSummary = useMemo(() => {
    const rawExplanation =
      explanation?.explanation ||
      `Vehicle is ${telemetry.status || "waiting"} with current mode ${telemetry.mode || "AUTO"}.`;

    if (rawExplanation.length <= 120) {
      return rawExplanation;
    }

    return `${rawExplanation.slice(0, 117).trim()}…`;
  }, [explanation, telemetry]);

  useEffect(() => {
    let currentBlobUrl = null;
    const waitForIceGatheringComplete = (peerConnection) =>
      new Promise((resolve) => {
        if (peerConnection.iceGatheringState === "complete") {
          resolve();
          return;
        }

        const handleIceGatheringStateChange = () => {
          if (peerConnection.iceGatheringState === "complete") {
            peerConnection.removeEventListener(
              "icegatheringstatechange",
              handleIceGatheringStateChange,
            );
            resolve();
          }
        };

        peerConnection.addEventListener(
          "icegatheringstatechange",
          handleIceGatheringStateChange,
        );
      });

    const closeWebRtc = () => {
      requestingWebRtcRef.current = false;

      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }

      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };

    const setCurrentVideoMode = (mode) => {
      videoModeRef.current = mode;
      setVideoMode(mode);
    };

    const startWebRtc = async () => {
      if (peerConnectionRef.current || requestingWebRtcRef.current) {
        return;
      }

      requestingWebRtcRef.current = true;
      setCurrentVideoMode("connecting");

      try {
        const peerConnection = new RTCPeerConnection({ iceServers: [] });
        peerConnectionRef.current = peerConnection;

        peerConnection.addTransceiver("video", { direction: "recvonly" });

        peerConnection.ontrack = (event) => {
          const [stream] = event.streams;

          if (videoRef.current && stream) {
            videoRef.current.srcObject = stream;
            setCurrentVideoMode("webrtc");
          }
        };

        peerConnection.onconnectionstatechange = () => {
          if (["failed", "closed", "disconnected"].includes(peerConnection.connectionState)) {
            closeWebRtc();
            setCurrentVideoMode(frameRef.current ? "fallback" : "waiting");
          }
        };

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        await waitForIceGatheringComplete(peerConnection);

        socket.emit("webrtc_offer", {
          type: peerConnection.localDescription.type,
          sdp: peerConnection.localDescription.sdp,
        });
      } catch (error) {
        console.error("WebRTC setup failed:", error);
        closeWebRtc();
        setCurrentVideoMode(frameRef.current ? "fallback" : "waiting");
      } finally {
        requestingWebRtcRef.current = false;
      }
    };

    const handleConnect = () => setConnected(true);
    const handleDisconnect = () => {
      setConnected(false);
      closeWebRtc();
    };

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

      if (state?.webrtc?.ready) {
        startWebRtc();
      }
    };

    const handleFrame = (frameData) => {
      if (typeof frameData === "string") {
        if (currentBlobUrl) {
          URL.revokeObjectURL(currentBlobUrl);
          currentBlobUrl = null;
        }

        const { url } = createFrameUrl(frameData);
        frameRef.current = url;
        setFrame(url);
      } else {
        const { url, objectUrl } = createFrameUrl(frameData);

        if (currentBlobUrl) {
          URL.revokeObjectURL(currentBlobUrl);
        }

        currentBlobUrl = objectUrl;
        frameRef.current = url;
        setFrame(url);
      }

      if (videoModeRef.current !== "webrtc") {
        setCurrentVideoMode("fallback");
      }

      setLastUpdated(new Date().toISOString());
    };

    const handleFrameTs = (ts) => {
      const now = Date.now();
      const latencyMs = now - Number(ts || 0);
      // Expose latency via debug log; could also show in UI
      console.debug("end-to-end latency ms:", latencyMs);
    };

    const handleExplanation = (data) => {
      setExplanation(data);
    };

    const handleWebRtcStatus = (status) => {
      if (status?.ready) {
        startWebRtc();
        return;
      }

      closeWebRtc();
      setCurrentVideoMode(frameRef.current ? "fallback" : "waiting");
    };

    const handleWebRtcAnswer = async (answer) => {
      const peerConnection = peerConnectionRef.current;

      if (!peerConnection || !answer?.sdp) {
        return;
      }

      await peerConnection.setRemoteDescription({
        type: answer.type || "answer",
        sdp: answer.sdp,
      });
    };

    const handleVehicleSession = (nextSession) => {
      setSession(nextSession);
      setAuthError("");
      setCommandWarning("");

      if (nextSession?.token) {
        localStorage.setItem("vehicleSessionToken", nextSession.token);
      } else {
        localStorage.removeItem("vehicleSessionToken");
      }
    };

    const handleCommandRejected = (payload) => {
      setCommandWarning(payload?.reason || "Command rejected.");
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("ai_data", handleAiData);
    socket.on("system_state", handleState);
    socket.on("live_stream", handleFrame);
    socket.on("live_stream_ts", handleFrameTs);
    socket.on("show_explanation", handleExplanation);
    socket.on("webrtc_status", handleWebRtcStatus);
    socket.on("webrtc_answer", handleWebRtcAnswer);
    socket.on("vehicle_session", handleVehicleSession);
    socket.on("command_rejected", handleCommandRejected);

    socket.emit("request_state");
    socket.emit("request_vehicles", (response) => {
      if (response?.ok && Array.isArray(response.vehicles) && response.vehicles.length) {
        setVehicles(response.vehicles);
        setSelectedVehicleId((current) =>
          response.vehicles.some((vehicle) => vehicle.id === current)
            ? current
            : response.vehicles[0].id,
        );
      }
    });

    const savedToken = localStorage.getItem("vehicleSessionToken");

    if (savedToken) {
      socket.emit("session_restore", { token: savedToken }, (response) => {
        if (!response?.ok) {
          localStorage.removeItem("vehicleSessionToken");
          return;
        }

        setSession(response.session);

        if (Array.isArray(response.vehicles) && response.vehicles.length) {
          setVehicles(response.vehicles);
          setSelectedVehicleId(response.session.vehicle.id);
        }
      });
    }

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("ai_data", handleAiData);
      socket.off("system_state", handleState);
      socket.off("live_stream", handleFrame);
      socket.off("live_stream_ts", handleFrameTs);
      socket.off("show_explanation", handleExplanation);
      socket.off("webrtc_status", handleWebRtcStatus);
      socket.off("webrtc_answer", handleWebRtcAnswer);
      socket.off("vehicle_session", handleVehicleSession);
      socket.off("command_rejected", handleCommandRejected);
      closeWebRtc();
    };
  }, []);

  const missionSummary = useMemo(
    () => getMissionSummary({ telemetry, connected, session }),
    [telemetry, connected, session],
  );
  const riskLevel = missionSummary.riskLevel;

  const handleLogin = (event) => {
    event.preventDefault();
    setAuthError("");
    setCommandWarning("");

    if (!username.trim() || !password.trim()) {
      setAuthError("Username and password are required.");
      return;
    }

    setAuthPending(true);

    socket.emit(
      "vehicle_login",
      {
        vehicleId: selectedVehicleId,
        username,
        password,
      },
      (response) => {
        setAuthPending(false);

        if (!response?.ok) {
          setAuthError(response?.error || "Login failed.");
          return;
        }

        setSession(response.session);
        localStorage.setItem("vehicleSessionToken", response.session.token);
        setPassword("");

        if (Array.isArray(response.vehicles) && response.vehicles.length) {
          setVehicles(response.vehicles);
          setSelectedVehicleId(response.session.vehicle.id);
        }
      },
    );
  };

  const handleLogout = () => {
    socket.emit("vehicle_logout");
    setSession(null);
    setPassword("");
    setCommandWarning("");
    localStorage.removeItem("vehicleSessionToken");
  };

  if (!session) {
    return (
      <LoginPage
        vehicles={vehicles}
        selectedVehicleId={selectedVehicleId}
        setSelectedVehicleId={setSelectedVehicleId}
        username={username}
        setUsername={setUsername}
        password={password}
        setPassword={setPassword}
        authError={authError}
        authPending={authPending}
        onSubmit={handleLogin}
      />
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Real-time autonomous vehicle project</p>
          <h1>Self Driving Control Room</h1>
          <p className="session-copy">
            {session.vehicle.name} unlocked for {session.user.displayName} ({session.role})
          </p>
        </div>

        <div className="topbar-actions">
          <div className={`connection-pill ${connected ? "online" : "offline"}`}>
            <span />
            {connected ? "Live backend connected" : "Backend offline"}
          </div>
          <button className="logout-button" type="button" onClick={handleLogout}>
            Lock car
          </button>
        </div>
      </header>

      {commandWarning ? <p className="command-warning">{commandWarning}</p> : null}

      <section className="dashboard-grid">
        <div className="status-banner" aria-label="Mission status overview">
          <div>
            <p className="eyebrow">Operations overview</p>
            <h2>{missionSummary.riskLabel}</h2>
          </div>
          <div className="status-banner-meta">
            <span>{missionSummary.connectionLabel}</span>
            <span>{missionSummary.autonomyLabel}</span>
            <span>{missionSummary.operatorRole}</span>
          </div>
        </div>

        <div className="camera-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Camera stream</p>
              <h2>Front road view</h2>
            </div>
            <p className="timestamp">Updated {formatTime(lastUpdated)}</p>
          </div>

          <div className="video-wrapper">
            <video
              ref={videoRef}
              className={`video-feed ${videoMode === "webrtc" ? "" : "hidden-video"}`}
              autoPlay
              muted
              playsInline
            />

            {videoMode !== "webrtc" && frame ? (
              <img src={frame} alt="Live annotated road feed" className="video-feed" />
            ) : (
              videoMode !== "webrtc" && (
                <div className="empty-feed">
                  <strong>Waiting for camera frames</strong>
                  <span>
                    {videoMode === "connecting"
                      ? "Connecting WebRTC video stream..."
                      : "Start the AI camera process to stream annotated video."}
                  </span>
                </div>
              )
            )}

            <span className={`stream-badge ${videoMode}`}>
              {videoMode === "webrtc" ? "WebRTC" : "Socket fallback"}
            </span>
          </div>
        </div>

        <aside className={`decision-panel ${riskLevel}`}>
          <p className="eyebrow">Decision engine</p>
          <h2>{telemetry.action || "AUTO"}</h2>
          <p className="decision-copy">{explanationSummary}</p>

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
          {!["admin", "driver"].includes(session.role) ? (
            <p className="readonly-note">This account has view-only access to the selected car.</p>
          ) : null}
          <ControlPanel
            activeCommand={telemetry.mode || telemetry.action}
            disabled={!["admin", "driver"].includes(session.role)}
          />
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
