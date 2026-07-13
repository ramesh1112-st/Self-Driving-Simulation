export function getMissionSummary({ telemetry, connected, session }) {
  const action = String(telemetry?.action || "").toUpperCase();
  const mode = String(telemetry?.mode || "AUTO").toUpperCase();
  const role = session?.role || "viewer";

  let riskLevel = "normal";
  let riskLabel = "Routine monitoring";
  let autonomyLabel = "Autonomous mode active";
  let connectionLabel = connected ? "Vehicle network stable" : "Network degraded";
  let operatorRole = "Fleet supervisor";

  if (["STOP", "BRAKE", "EMERGENCY"].includes(action)) {
    riskLevel = "critical";
    riskLabel = "Immediate intervention";
    autonomyLabel = "Human override required";
  } else if (["SLOW", "LEFT", "RIGHT"].includes(action)) {
    riskLevel = "warning";
    riskLabel = "Caution required";
    autonomyLabel = "Shared control engaged";
  }

  if (role === "driver") {
    operatorRole = "Vehicle operator";
  } else if (role === "viewer") {
    operatorRole = "Remote observer";
  }

  if (mode === "MANUAL") {
    autonomyLabel = "Manual control in effect";
  }

  return {
    riskLevel,
    riskLabel,
    autonomyLabel,
    connectionLabel,
    operatorRole,
  };
}
