const assert = require("node:assert/strict");
const { describe, it, beforeEach } = require("node:test");

const {
  addLog,
  normalizeCommand,
  stamp,
  state,
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
});
