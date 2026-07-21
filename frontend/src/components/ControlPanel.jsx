import socket from "../socket";
import { commands } from "./driveCommands";
import "./ControlPanel.css";

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
