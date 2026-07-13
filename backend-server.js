const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const cors = require("cors");

const PORT = process.env.PORT || 5000;
const MAX_LOGS = 100;
const MAX_AUDIT_LOGS = 1000;
const STATE_PUBLISH_INTERVAL_MS = 250;
const AUTH_DB_PATH = process.env.AUTH_DB_PATH || path.join(__dirname, "backend", "data", "auth-db.json");
const AUTH_SECRET = process.env.AUTH_SECRET || "dev-secret-change-before-production";
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 1000 * 60 * 60 * 8);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 1000 * 60 * 15);
const RATE_LIMIT_MAX_ATTEMPTS = Number(process.env.RATE_LIMIT_MAX_ATTEMPTS || 5);
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

function createDefaultDatabase() {
  return {
    users: [
      {
        id: "user-admin",
        username: "admin",
        displayName: "Admin Operator",
        role: "admin",
        password: {
          salt: "seed-admin",
          hash: "dc5372934b17cc01bf9ada62dc8c75b7249b158af8f0bb7cf340530f6f4aebb0",
        },
      },
      {
        id: "user-driver",
        username: "driver",
        displayName: "Vehicle Driver",
        role: "driver",
        password: {
          salt: "seed-driver",
          hash: "792418f9576e7aaa2b9b6171a6929c50cb70e0476e5ecb7aa081e8920b75f758",
        },
      },
      {
        id: "user-viewer",
        username: "viewer",
        displayName: "Read Only Viewer",
        role: "viewer",
        password: {
          salt: "seed-viewer",
          hash: "d5c81c6ea6a3973e0747f3a3b88e216f7c172fc270bc5997d1a7566c568428a6",
        },
      },
    ],
    vehicles: [
      { id: "car-01", name: "Car 01" },
      { id: "car-02", name: "Car 02" },
      { id: "car-03", name: "Car 03" },
    ],
    vehiclePermissions: [
      { userId: "user-admin", vehicleId: "car-01", role: "admin" },
      { userId: "user-admin", vehicleId: "car-02", role: "admin" },
      { userId: "user-admin", vehicleId: "car-03", role: "admin" },
      { userId: "user-driver", vehicleId: "car-01", role: "driver" },
      { userId: "user-driver", vehicleId: "car-02", role: "driver" },
      { userId: "user-viewer", vehicleId: "car-01", role: "viewer" },
    ],
    auditLogs: [],
  };
}

function ensureDatabaseShape(data) {
  const defaults = createDefaultDatabase();

  return {
    users: Array.isArray(data?.users) ? data.users : defaults.users,
    vehicles: Array.isArray(data?.vehicles) ? data.vehicles : defaults.vehicles,
    vehiclePermissions: Array.isArray(data?.vehiclePermissions)
      ? data.vehiclePermissions
      : defaults.vehiclePermissions,
    auditLogs: Array.isArray(data?.auditLogs) ? data.auditLogs : [],
  };
}

function persistDatabase() {
  fs.mkdirSync(path.dirname(AUTH_DB_PATH), { recursive: true });
  const tempPath = `${AUTH_DB_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(database, null, 2));
  fs.renameSync(tempPath, AUTH_DB_PATH);
}

function loadDatabase() {
  if (!fs.existsSync(AUTH_DB_PATH)) {
    const initialDatabase = createDefaultDatabase();
    fs.mkdirSync(path.dirname(AUTH_DB_PATH), { recursive: true });
    fs.writeFileSync(AUTH_DB_PATH, JSON.stringify(initialDatabase, null, 2));
    return initialDatabase;
  }

  return ensureDatabaseShape(JSON.parse(fs.readFileSync(AUTH_DB_PATH, "utf8")));
}

const database = loadDatabase();

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 32, "sha256").toString("hex");
}

function timingSafeEqualHex(left, right) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");

  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function publicUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
  };
}

function publicVehicles() {
  return database.vehicles.map(({ id, name }) => ({ id, name }));
}

function findUserByUsername(username) {
  return database.users.find(
    (user) => user.username.toLowerCase() === String(username || "").trim().toLowerCase(),
  );
}

function findVehicle(vehicleId) {
  return database.vehicles.find((vehicle) => vehicle.id === vehicleId);
}

function getVehiclePermission(userId, vehicleId) {
  return database.vehiclePermissions.find(
    (permission) => permission.userId === userId && permission.vehicleId === vehicleId,
  );
}

function getPermittedVehicles(userId) {
  return database.vehiclePermissions
    .filter((permission) => permission.userId === userId)
    .map((permission) => {
      const vehicle = findVehicle(permission.vehicleId);
      return vehicle ? { ...vehicle, permission: permission.role } : null;
    })
    .filter(Boolean);
}

function appendAuditLog(event, details = {}) {
  const entry = {
    id: crypto.randomUUID(),
    event,
    timestamp: new Date().toISOString(),
    ...details,
  };

  database.auditLogs.push(entry);

  if (database.auditLogs.length > MAX_AUDIT_LOGS) {
    database.auditLogs = database.auditLogs.slice(-MAX_AUDIT_LOGS);
  }

  persistDatabase();
  return entry;
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

function verifySessionToken(token) {
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

    const user = database.users.find((item) => item.id === claims.sub);
    const vehicle = findVehicle(claims.vehicleId);
    const permission = user && vehicle ? getVehiclePermission(user.id, vehicle.id) : null;

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

function authenticateUser({ username, password, vehicleId, ipAddress = "unknown" }) {
  const cleanUsername = String(username || "").trim();
  const rateLimitKey = `${ipAddress}:${cleanUsername.toLowerCase() || "anonymous"}`;

  if (isRateLimited(rateLimitKey)) {
    appendAuditLog("login_rate_limited", { username: cleanUsername, vehicleId, ipAddress });
    return { ok: false, error: "Too many failed login attempts. Try again later." };
  }

  const user = findUserByUsername(cleanUsername);
  const vehicle = findVehicle(vehicleId);
  const passwordHash = user ? hashPassword(String(password || ""), user.password.salt) : "";
  const passwordMatches = user && timingSafeEqualHex(passwordHash, user.password.hash);
  const permission = user && vehicle ? getVehiclePermission(user.id, vehicle.id) : null;

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

  return { ok: true, session, vehicles: getPermittedVehicles(user.id) };
}

function canSendDriveCommand(session) {
  return ["admin", "driver"].includes(session?.role);
}

function stamp(payload = {}) {
  return {
    ...payload,
    timestamp: payload.timestamp || new Date().toISOString(),
  };
}

function normalizeCommand(payload) {
  if (typeof payload === "string") {
    return stamp({
      command: payload,
      source: "legacy-client",
    });
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

  socket.on("request_vehicles", (reply) => {
    if (typeof reply === "function") {
      reply({ ok: true, vehicles: publicVehicles() });
    }
  });

  socket.on("session_restore", (payload = {}, reply) => {
    const session = verifySessionToken(payload.token);

    if (!session) {
      if (typeof reply === "function") {
        reply({ ok: false, error: "Session expired. Please log in again." });
      }

      return;
    }

    vehicleSessions.set(socket.id, session);
    socket.emit("vehicle_session", session);

    if (typeof reply === "function") {
      reply({ ok: true, session, vehicles: getPermittedVehicles(session.user.id) });
    }
  });

  socket.on("vehicle_login", (payload = {}, reply) => {
    const result = authenticateUser({
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

  socket.on("vehicle_logout", () => {
    const session = vehicleSessions.get(socket.id);

    if (session) {
      appendAuditLog("logout", {
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

  socket.on("control_command", (payload) => {
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

    if (!canSendDriveCommand(session)) {
      appendAuditLog("command_rejected", {
        userId: session.user.id,
        username: session.user.username,
        vehicleId: session.vehicle.id,
        vehicleName: session.vehicle.name,
        role: session.role,
        reason: "role_not_allowed",
        ipAddress: socket.handshake.address,
      });
      socket.emit("command_rejected", {
        reason: "Your role can view this car but cannot send drive commands.",
      });
      return;
    }

    const command = normalizeCommand(payload);

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

app.get("/vehicles", (req, res) => {
  res.json(publicVehicles());
});

app.get("/logs", (req, res) => {
  res.json(state.logs);
});

app.get("/audit-logs", (req, res) => {
  res.json(database.auditLogs.slice().reverse());
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
  database,
  getPermittedVehicles,
  publicVehicles,
  verifySessionToken,
  publishStateThrottled,
};
