import { describe, expect, it } from "vitest";
import { getMissionSummary } from "./missionUtils";

describe("getMissionSummary", () => {
  it("returns a realistic safety summary for critical interventions", () => {
    const summary = getMissionSummary({
      telemetry: { action: "STOP", status: "Emergency braking", mode: "AUTO" },
      connected: true,
      session: { role: "driver" },
    });

    expect(summary.riskLevel).toBe("critical");
    expect(summary.riskLabel).toBe("Immediate intervention");
    expect(summary.autonomyLabel).toBe("Human override required");
    expect(summary.operatorRole).toBe("Vehicle operator");
  });

  it("returns a steady-state summary when the system is operating normally", () => {
    const summary = getMissionSummary({
      telemetry: { action: "AUTO", status: "Cruising", mode: "AUTO" },
      connected: true,
      session: { role: "admin" },
    });

    expect(summary.riskLevel).toBe("normal");
    expect(summary.riskLabel).toBe("Routine monitoring");
    expect(summary.connectionLabel).toBe("Vehicle network stable");
    expect(summary.operatorRole).toBe("Fleet supervisor");
  });
});
