import socket from "../socket";
import "./ControlPanel.css";

export const commands = [
  { label: "Auto", value: "AUTO", variant: "primary" },
  { label: "Stop", value: "STOP", variant: "danger" },
  { label: "Brake", value: "BRAKE", variant: "danger" },
  { label: "Left", value: "LEFT", variant: "secondary" },
  { label: "Right", value: "RIGHT", variant: "secondary" },
  { label: "Slow", value: "SLOW", variant: "secondary" },
];

function ControlPanel({ activeCommand = "AUTO", disabled = false }) {
  const sendCommand = (command) => {
    if (disabled) return;

    socket.emit("control_command", command);
  };

  return (
    <div className="controls" aria-label="Manual drive controls">
      {commands.map((item) => (
        <button
          className={`${item.variant} ${activeCommand === item.value ? "active" : ""}`}
          key={item.value}
          disabled={disabled}
          onClick={() => sendCommand(item.value)}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export default ControlPanel;
