const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { authenticateUser, registerUser } = require("../backend-server");

describe("signup flow", () => {
  it("creates a user account and allows login for the selected vehicle", async () => {
    const username = `signup${Date.now()}`;

    const signup = await registerUser({
      displayName: "New Driver",
      username,
      password: "StrongPass123!",
      confirmPassword: "StrongPass123!",
      role: "driver",
      vehicleId: "car-01",
      ipAddress: "test-signup",
    });

    assert.equal(signup.ok, true);

    const login = await authenticateUser({
      username,
      password: "StrongPass123!",
      vehicleId: "car-01",
      ipAddress: "test-signup-login",
    });

    assert.equal(login.ok, true);
    assert.equal(login.session.user.username, username);
  });
});
