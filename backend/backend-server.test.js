const assert = require("node:assert/strict");
const { describe, it, beforeEach } = require("node:test");
const prisma = require("./db/prisma");

const {
  addLog,
  authenticateUser,
  canSendDriveCommand,
  database,
  getPermittedVehicles,
  normalizeCommand,
  publicVehicles,
  stamp,
  state,
  verifySessionToken,
} = require("../backend-server");

describe("backend helpers", () => {
  beforeEach(() => {
    state.logs = [];
  });

  it("normalizes legacy string commands", () => {
    const command = normalizeCommand("BRAKE");

    assert.equal(command.command, "BRAKE");
    assert.equal(command.source, "legacy-client");
    assert.match(command.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  });

  it("normalizes dashboard command payloads", () => {
    const command = normalizeCommand({
      command: "LEFT",
      source: "test",
      timestamp: "2026-07-02T10:00:00.000Z",
    });

    assert.deepEqual(command, {
      command: "LEFT",
      source: "test",
      timestamp: "2026-07-02T10:00:00.000Z",
    });
  });

  it("stamps payloads without replacing existing timestamps", () => {
    const stamped = stamp({ value: 1, timestamp: "fixed" });

    assert.deepEqual(stamped, { value: 1, timestamp: "fixed" });
  });

  it("keeps only the latest 100 logs", () => {
    for (let index = 0; index < 105; index += 1) {
      addLog({ index });
    }

    assert.equal(state.logs.length, 100);
    assert.equal(state.logs[0].index, 5);
    assert.equal(state.logs.at(-1).index, 104);
  });

  it("rejects unsupported drive commands", () => {
    assert.equal(normalizeCommand("ACCELERATE"), null);
  });

  it("authenticates users with vehicle permissions", () => {
    const result = authenticateUser({
      username: "driver",
      password: "driver123",
      vehicleId: "car-01",
      ipAddress: "test-auth-success",
    });

    assert.equal(result.ok, true);
    assert.equal(result.session.user.username, "driver");
    assert.equal(result.session.vehicle.id, "car-01");
    assert.equal(result.session.role, "driver");
  });

  it("rejects invalid user credentials and vehicle permissions", () => {
    assert.equal(
      authenticateUser({
        username: "driver",
        password: "wrong",
        vehicleId: "car-01",
        ipAddress: "test-auth-fail-password",
      }).ok,
      false,
    );
    assert.equal(
      authenticateUser({
        username: "viewer",
        password: "viewer123",
        vehicleId: "car-03",
        ipAddress: "test-auth-fail-permission",
      }).ok,
      false,
    );
  });

  it("does not expose secrets in public vehicle data", () => {
    const vehicles = publicVehicles();

    assert.equal(vehicles.length, 3);
    assert.deepEqual(vehicles[0], { id: "car-01", name: "Car 01" });
    assert.equal(Object.hasOwn(vehicles[0], "accessCode"), false);
  });

  it("restores signed session tokens", () => {
    const result = authenticateUser({
      username: "admin",
      password: "admin123",
      vehicleId: "car-03",
      ipAddress: "test-token",
    });
    const restored = verifySessionToken(result.session.token);

    assert.equal(restored.user.username, "admin");
    assert.equal(restored.vehicle.id, "car-03");
    assert.equal(restored.role, "admin");
  });

  it("returns vehicles permitted for a user", () => {
    assert.deepEqual(
      getPermittedVehicles("user-viewer"),
      [{ id: "car-01", name: "Car 01", permission: "viewer" }],
    );
  });

  it("allows only admin and driver roles to send commands", () => {
    assert.equal(
      canSendDriveCommand({ user: { id: "user-admin" }, vehicle: { id: "car-01" } }),
      true,
    );
    assert.equal(
      canSendDriveCommand({ user: { id: "user-driver" }, vehicle: { id: "car-01" } }),
      true,
    );
    assert.equal(
      canSendDriveCommand({ user: { id: "user-viewer" }, vehicle: { id: "car-01" } }),
      false,
    );
    assert.equal(canSendDriveCommand(null), false);
  });

  it("requires an active vehicle permission before allowing a command", () => {
    assert.equal(
      canSendDriveCommand({
        user: { id: "user-driver" },
        vehicle: { id: "car-03" },
        role: "driver",
      }),
      false,
    );
  });

  it("stores audit logs for auth events", () => {
    assert.ok(database.auditLogs.some((entry) => entry.event === "login_succeeded"));
  });
});
