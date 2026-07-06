const express = require("./backend/node_modules/express");
const http = require("http");
const { Server } = require("./backend/node_modules/socket.io");
const cors = require("./backend/node_modules/cors");

const PORT = process.env.PORT || 5000;
const MAX_LOGS = 100;
const STATE_PUBLISH_INTERVAL_MS = 250;
let lastStatePublishAt = 0;

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_ORIGIN || "*",
  },
  maxHttpBufferSize: 1e7,
});

const state = {
  mode: "AUTO",
  lastCommand: null,
  lastDetection: null,
  lastFrameAt: null,
  webrtc: {
    ready: false,
    reason: "AI camera process has not announced WebRTC support yet.",
    updatedAt: null,
  },
  updatedAt: new Date().toISOString(),
  logs: [],
};

function stamp(payload = {}) {
  return {
    ...payload,
    timestamp: payload.timestamp || new Date().toISOString(),
  };
}

function normalizeCommand(payload) {
  if (typeof payload === "string") {
    return stamp({ command: payload, source: "legacy-client" });
  }

  return stamp({
    command: payload?.command || "AUTO",
    source: payload?.source || "dashboard",
    timestamp: payload?.timestamp,
  });
}

function publishState(target = io) {
  target.emit("system_state", {
    ...state,
    clientCount: io.engine.clientsCount,
  });
}

function publishStateThrottled() {
  const now = Date.now();

  if (now - lastStatePublishAt < STATE_PUBLISH_INTERVAL_MS) {
    return;
  }

  lastStatePublishAt = now;
  publishState();
}

function addLog(data) {
  state.logs.push(data);

  if (state.logs.length > MAX_LOGS) {
    state.logs = state.logs.slice(-MAX_LOGS);
  }
}

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);
  publishState(socket);

  socket.on("request_state", () => {
    publishState(socket);
  });

  socket.on("control_command", (payload) => {
    const command = normalizeCommand(payload);

    state.mode = command.command === "AUTO" ? "AUTO" : "MANUAL";
    state.lastCommand = command;
    state.updatedAt = command.timestamp;

    console.log("Manual command:", command);

    io.emit("control_command", command.command);
    publishState();
  });

  socket.on("detection", (payload) => {
    const detection = stamp({
      ...payload,
      mode: state.mode,
    });

    state.lastDetection = detection;
    state.updatedAt = detection.timestamp;
    addLog(detection);

    console.log("Detection:", detection);

    io.emit("ai_data", detection);
    publishStateThrottled();
  });

  socket.on("ai_explanation", (payload) => {
    const explanation = stamp(payload);

    console.log("AI Explanation:", explanation);
    io.emit("show_explanation", explanation);
  });

  socket.on("webrtc_status", (payload = {}) => {
    state.webrtc = {
      ready: Boolean(payload.ready),
      reason: payload.reason || null,
      updatedAt: new Date().toISOString(),
    };

    io.emit("webrtc_status", state.webrtc);
    publishState();
  });

  socket.on("webrtc_offer", (payload) => {
    socket.broadcast.emit("webrtc_offer", {
      ...payload,
      viewerId: socket.id,
    });
  });

  socket.on("webrtc_answer", (payload) => {
    if (payload?.viewerId) {
      io.to(payload.viewerId).emit("webrtc_answer", payload);
      return;
    }

    socket.broadcast.emit("webrtc_answer", payload);
  });

  socket.on("video_frame", (frame) => {
    state.lastFrameAt = new Date().toISOString();
    state.updatedAt = state.lastFrameAt;

    io.volatile.emit("live_stream", frame);
  });

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);
    publishState();
  });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    clients: io.engine.clientsCount,
    updatedAt: state.updatedAt,
  });
});

app.get("/state", (req, res) => {
  res.json({
    ...state,
    clientCount: io.engine.clientsCount,
  });
});

app.get("/logs", (req, res) => {
  res.json(state.logs);
});

app.get("/", (req, res) => {
  res.send("Self-driving backend running");
});

function startServer(port = PORT) {
  return server.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  addLog,
  app,
  io,
  normalizeCommand,
  publishStateThrottled,
  server,
  stamp,
  startServer,
  state,
};
