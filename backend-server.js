const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const cors = require("cors");
const prisma = require("./backend/db/prisma");

const PORT = process.env.PORT || 5001;
const MAX_LOGS = 100;
const MAX_AUDIT_LOGS = 1000;
const STATE_PUBLISH_INTERVAL_MS = 250;
const AUTH_DB_PATH = process.env.AUTH_DB_PATH || path.join(__dirname, "backend", "data", "auth-db.json");
const AUTH_SECRET = process.env.AUTH_SECRET || "dev-secret-change-before-production";
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 1000 * 60 * 60 * 8);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 1000 * 60 * 15);
const RATE_LIMIT_MAX_ATTEMPTS = Number(process.env.RATE_LIMIT_MAX_ATTEMPTS || 5);
const CONTROL_ROLES = new Set(["admin", "driver"]);
const VALID_DRIVE_COMMANDS = new Set(["AUTO", "STOP", "BRAKE", "LEFT", "RIGHT", "SLOW"]);
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

const vehicleSessions = new Map();
const loginAttempts = new Map();


function publicUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
  };
}

async function publicVehicles() {
  const vehicles = await prisma.vehicle.findMany();

  return vehicles.map(({ id, name }) => ({
    id,
    name,
  }));
}

async function findUserByUsername(username) {
  return await prisma.user.findUnique({
    where: {
      username: username,
    },
  });
}

async function findVehicle(vehicleId) {
  return await prisma.vehicle.findUnique({
    where: {
      id: vehicleId,
    },
  });
}

async function getVehiclePermission(userId, vehicleId) {
  return await prisma.vehiclePermission.findUnique({
    where: {
      userId_vehicleId: {
        userId,
        vehicleId,
      },
    },
  });
}

async function getPermittedVehicles(userId) {
  const permissions = await prisma.vehiclePermission.findMany({
    where: {
      userId,
    },
    include: {
      vehicle: true,
    },
  });

  return permissions.map((permission) => ({
    id: permission.vehicle.id,
    name: permission.vehicle.name,
    permission: permission.role,
  }));
}

async function appendAuditLog(event, details = {}) {
  return await prisma.auditLog.create({
    data: {
      event,
      ...details,
    },
  });
}

function isRateLimited(key, now = Date.now()) {
  const current = loginAttempts.get(key);

  if (!current || now > current.resetAt) {
    return false;
  }

  return current.count >= RATE_LIMIT_MAX_ATTEMPTS;
}

function recordFailedLogin(key, now = Date.now()) {
  const current = loginAttempts.get(key);

  if (!current || now > current.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return;
  }

  current.count += 1;
}

function clearLoginAttempts(key) {
  loginAttempts.delete(key);
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlJson(value) {
  return base64UrlEncode(JSON.stringify(value));
}

function signSessionPayload(payload) {
  return crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest("base64url");
}

function createSessionToken(session) {
  const header = base64UrlJson({ alg: "HS256", typ: "JWT" });
  const payload = base64UrlJson({
    sub: session.user.id,
    vehicleId: session.vehicle.id,
    role: session.role,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor((Date.now() + SESSION_TTL_MS) / 1000),
  });

  return `${header}.${payload}.${signSessionPayload(`${header}.${payload}`)}`;
}

async function verifySessionToken(token) {
  try {
    const parts = String(token || "").split(".");

    if (parts.length !== 3) return null;

    const [header, payload, signature] = parts;
    const expectedSignature = signSessionPayload(`${header}.${payload}`);
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (
      signatureBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      return null;
    }

    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));

    if (!claims.exp || claims.exp * 1000 < Date.now()) {
      return null;
    }

    const user = await prisma.user.findUnique({
  where: {
    id: claims.sub,
  },
});

const vehicle = await findVehicle(claims.vehicleId);

const permission =
  user && vehicle
    ? await getVehiclePermission(user.id, vehicle.id)
    : null;

    if (!user || !vehicle || !permission) {
      return null;
    }

    return createSession(user, vehicle, permission.role, token);
  } catch {
    return null;
  }
}

function createSession(user, vehicle, role, token = null) {
  const session = {
    user: publicUser(user),
    vehicle: { id: vehicle.id, name: vehicle.name },
    role,
    authenticatedAt: new Date().toISOString(),
  };

  return {
    ...session,
    token: token || createSessionToken(session),
  };
}

async function authenticateUser({ username, password, vehicleId, ipAddress = "unknown" }) {
  const cleanUsername = String(username || "").trim();
  const rateLimitKey = `${ipAddress}:${cleanUsername.toLowerCase() || "anonymous"}`;

  if (isRateLimited(rateLimitKey)) {
    appendAuditLog("login_rate_limited", { username: cleanUsername, vehicleId, ipAddress });
    return { ok: false, error: "Too many failed login attempts. Try again later." };
  }

  const user = await findUserByUsername(cleanUsername);
  const vehicle = await findVehicle(vehicleId);
  const passwordMatches =
  user && user.password === String(password || "");
  const permission =
  user && vehicle
    ? await getVehiclePermission(user.id, vehicle.id)
    : null;


  if (!user || !vehicle || !passwordMatches || !permission) {
    recordFailedLogin(rateLimitKey);
    appendAuditLog("login_failed", {
      username: cleanUsername,
      vehicleId,
      ipAddress,
      reason: !permission && user && vehicle ? "vehicle_permission_denied" : "invalid_credentials",
    });
    return { ok: false, error: "Invalid username, password, or vehicle permission." };
  }

  clearLoginAttempts(rateLimitKey);
  const session = createSession(user, vehicle, permission.role);

  appendAuditLog("login_succeeded", {
    userId: user.id,
    username: user.username,
    vehicleId: vehicle.id,
    vehicleName: vehicle.name,
    role: permission.role,
    ipAddress,
  });

  return { ok: true, session, vehicles: await getPermittedVehicles(user.id) };
}

async function canSendDriveCommand(session) {
  if (!session?.user?.id || !session?.vehicle?.id) return false;

  const permission = await getVehiclePermission(
  session.user.id,
  session.vehicle.id
);
  return Boolean(permission && CONTROL_ROLES.has(permission.role));
}

function stamp(payload = {}) {
  return {
    ...payload,
    timestamp: payload.timestamp || new Date().toISOString(),
  };
}

function normalizeCommand(payload) {
  const rawCommand = typeof payload === "string" ? payload : payload?.command;
  const command = String(rawCommand || "AUTO").trim().toUpperCase();

  if (!VALID_DRIVE_COMMANDS.has(command)) {
    return null;
  }

  if (typeof payload === "string") {
    return stamp({
      command,
      source: "legacy-client",
    });
  }

  return stamp({
    command,
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

  if (now - lastStatePublishAt < STATE_PUBLISH_INTERVAL_MS) return;

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

  socket.on("request_vehicles", async (reply) => {
    if (typeof reply === "function") {
      reply({ ok: true, vehicles: await publicVehicles() });
    }
  });

  socket.on("session_restore", async (payload = {}, reply) => {
    const session = await verifySessionToken(payload.token);

    if (!session) {
      if (typeof reply === "function") {
        reply({ ok: false, error: "Session expired. Please log in again." });
      }

      return;
    }

    vehicleSessions.set(socket.id, session);
    socket.emit("vehicle_session", session);

    if (typeof reply === "function") {
      reply({ ok: true, session, vehicles: await getPermittedVehicles(session.user.id) });
    }
  });

  socket.on("vehicle_login", async (payload = {}, reply) => {
    const result = await authenticateUser({
      username: payload.username,
      password: payload.password,
      vehicleId: payload.vehicleId,
      ipAddress: socket.handshake.address,
    });

    if (!result.ok) {
      if (typeof reply === "function") {
        reply(result);
      }

      return;
    }

    vehicleSessions.set(socket.id, result.session);
    socket.emit("vehicle_session", result.session);

    if (typeof reply === "function") {
      reply(result);
    }
  });

  socket.on("vehicle_logout", async () => {
    const session = vehicleSessions.get(socket.id);

    if (session) {
      await appendAuditLog("logout", {
        userId: session.user.id,
        username: session.user.username,
        vehicleId: session.vehicle.id,
        vehicleName: session.vehicle.name,
        role: session.role,
        ipAddress: socket.handshake.address,
      });
    }

    vehicleSessions.delete(socket.id);
    socket.emit("vehicle_session", null);
  });

  socket.on("control_command", async (payload) => {
    const session = vehicleSessions.get(socket.id);

    if (!session) {
      appendAuditLog("command_rejected", {
        reason: "not_authenticated",
        ipAddress: socket.handshake.address,
      });
      socket.emit("command_rejected", {
        reason: "Login required before sending drive commands.",
      });
      return;
    }

    if (!await canSendDriveCommand(session)) {
      appendAuditLog("command_rejected", {
        userId: session.user.id,
        username: session.user.username,
        vehicleId: session.vehicle.id,
        vehicleName: session.vehicle.name,
        role: session.role,
        reason: "control_permission_denied",
        ipAddress: socket.handshake.address,
      });
      socket.emit("command_rejected", {
        reason: "You do not have permission to send drive commands for this vehicle.",
      });
      return;
    }

    const command = normalizeCommand(payload);

    if (!command) {
      appendAuditLog("command_rejected", {
        userId: session.user.id,
        username: session.user.username,
        vehicleId: session.vehicle.id,
        role: session.role,
        reason: "invalid_command",
        ipAddress: socket.handshake.address,
      });
      socket.emit("command_rejected", {
        reason: "Unsupported drive command.",
      });
      return;
    }

    state.mode = command.command === "AUTO" ? "AUTO" : "MANUAL";
    state.lastCommand = {
      ...command,
      vehicleId: session.vehicle.id,
      vehicleName: session.vehicle.name,
      userId: session.user.id,
      username: session.user.username,
      operator: session.user.displayName,
      role: session.role,
    };
    state.updatedAt = command.timestamp;

    appendAuditLog("command_sent", state.lastCommand);

    console.log("Manual command:", state.lastCommand);

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
    vehicleSessions.delete(socket.id);
    publishState();
  });
});

app.get("/", (req, res) => {
  res.send("Self Driving Backend Running");
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

app.get("/vehicles", async (req, res) => {
  res.json(await publicVehicles());
});

app.get("/logs", (req, res) => {
  res.json(state.logs);
});

app.get("/audit-logs", async (req, res) => {
    const logs = await prisma.auditLog.findMany({
        orderBy: {
            timestamp: "desc",
        },
    });

    res.json(logs);
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
  app,
  server,
  io,
  state,
  startServer,
  addLog,
  stamp,
  normalizeCommand,
  appendAuditLog,
  authenticateUser,
  canSendDriveCommand,
  createSessionToken,
  getPermittedVehicles,
  publicVehicles,
  verifySessionToken,
  publishStateThrottled,
};
