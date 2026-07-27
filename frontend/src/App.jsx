import { useEffect, useMemo, useRef, useState } from "react";
import socket from "./socket";
import ControlPanel from "./components/ControlPanel";
import { createFrameUrl } from "./frameUtils";
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

function AuthPage({
  vehicles,
  selectedVehicleId,
  setSelectedVehicleId,
  username,
  setUsername,
  password,
  setPassword,
  displayName,
  setDisplayName,
  confirmPassword,
  setConfirmPassword,
  authError,
  authMessage,
  authPending,
  authMode,
  setAuthMode,
  onSubmit,
}) {
  const isSignup = authMode === "signup";

  return (
    <main className="login-shell">
      <section className="login-panel" aria-labelledby="auth-title">
        <div className="login-header">
          <div>
            <p className="eyebrow">Secure vehicle access</p>
            <h1 id="auth-title">{isSignup ? "Create operator account" : "Car login"}</h1>
            <p className="login-copy">
              {isSignup
                ? "Register a new operator account, then access the fleet dashboard for your vehicle."
                : "Sign in with your operator account, then select a vehicle you are authorized to access."}
            </p>
          </div>

          <div className="auth-toggle" role="tablist" aria-label="Authentication mode">
            <button
              type="button"
              className={isSignup ? "toggle-button" : "toggle-button active"}
              onClick={() => setAuthMode("login")}
            >
              Login
            </button>
            <button
              type="button"
              className={isSignup ? "toggle-button active" : "toggle-button"}
              onClick={() => setAuthMode("signup")}
            >
              Sign up
            </button>
          </div>
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

          {isSignup ? (
            <label>
              <span>Full name</span>
              <input
                autoComplete="name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Enter your full name"
              />
            </label>
          ) : null}

          <label>
            <span>Username</span>
            <input
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Enter your operator username"
            />
          </label>

          <label>
            <span>Password</span>
            <input
              autoComplete={isSignup ? "new-password" : "current-password"}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={isSignup ? "Choose a strong password" : "Enter password"}
            />
          </label>

          {isSignup ? (
            <label>
              <span>Confirm password</span>
              <input
                autoComplete="new-password"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Re-enter password"
              />
            </label>
          ) : null}

          {authError ? <p className="auth-error">{authError}</p> : null}
          {authMessage ? <p className="auth-success">{authMessage}</p> : null}

          <button type="submit" disabled={authPending}>
            {authPending
              ? isSignup
                ? "Creating account..."
                : "Checking access..."
              : isSignup
                ? "Create account"
                : "Unlock Control Room"}
          </button>
        </form>

        <p className="login-hint">
          Access is assigned by role: admins and authorized drivers can send commands;
          viewers have read-only access.
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
  const [displayName, setDisplayName] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [session, setSession] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [authError, setAuthError] = useState("");
  const [authMessage, setAuthMessage] = useState("");
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

  const riskLevel = useMemo(() => {
    const action = String(telemetry.action || "").toUpperCase();

    if (["STOP", "BRAKE", "EMERGENCY"].includes(action)) return "critical";
    if (["SLOW", "LEFT", "RIGHT"].includes(action)) return "warning";
    return "normal";
  }, [telemetry.action]);

  const handleAuthSubmit = (event) => {
    event.preventDefault();
    setAuthError("");
    setAuthMessage("");
    setCommandWarning("");

    if (!username.trim() || !password.trim()) {
      setAuthError("Username and password are required.");
      return;
    }

    if (authMode === "signup") {
      if (!displayName.trim()) {
        setAuthError("Please enter your full name.");
        return;
      }

      if (password !== confirmPassword) {
        setAuthError("Passwords do not match.");
        return;
      }
    }

    setAuthPending(true);

    const payload = {
      vehicleId: selectedVehicleId,
      username,
      password,
    };

    const eventName = authMode === "signup" ? "user_signup" : "vehicle_login";

    socket.emit(eventName, authMode === "signup" ? {
      ...payload,
      displayName,
      confirmPassword,
      role: "viewer",
    } : payload, (response) => {
      setAuthPending(false);

      if (!response?.ok) {
        setAuthError(response?.error || "Authentication failed.");
        return;
      }

      if (authMode === "signup") {
        setAuthMode("login");
        setUsername("");
        setPassword("");
        setDisplayName("");
        setConfirmPassword("");
        setAuthMessage(response?.message || "Account created successfully. Please log in to continue.");
        return;
      }

      setSession(response.session);
      localStorage.setItem("vehicleSessionToken", response.session.token);
      setPassword("");
      setConfirmPassword("");
      setDisplayName("");
      setAuthMessage("");

      if (Array.isArray(response.vehicles) && response.vehicles.length) {
        setVehicles(response.vehicles);
        setSelectedVehicleId(response.session.vehicle.id);
      }
    });
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
      <AuthPage
        vehicles={vehicles}
        selectedVehicleId={selectedVehicleId}
        setSelectedVehicleId={setSelectedVehicleId}
        username={username}
        setUsername={setUsername}
        password={password}
        setPassword={setPassword}
        displayName={displayName}
        setDisplayName={setDisplayName}
        confirmPassword={confirmPassword}
        setConfirmPassword={setConfirmPassword}
        authError={authError}
        authMessage={authMessage}
        authPending={authPending}
        authMode={authMode}
        setAuthMode={setAuthMode}
        onSubmit={handleAuthSubmit}
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
