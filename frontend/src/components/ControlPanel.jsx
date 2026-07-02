import socket from "../socket";
import "./ControlPanel.css";

const commands = [
  { label: "Auto", value: "AUTO", variant: "primary" },
  { label: "Stop", value: "STOP", variant: "danger" },
  { label: "Brake", value: "BRAKE", variant: "danger" },
  { label: "Left", value: "LEFT", variant: "secondary" },
  { label: "Right", value: "RIGHT", variant: "secondary" },
  { label: "Slow", value: "SLOW", variant: "secondary" },
];

function ControlPanel({ activeCommand = "AUTO" }) {
  const sendCommand = (command) => {
    socket.emit("control_command", command);
  };

  return (
    <div className="controls" aria-label="Manual drive controls">
      {commands.map((item) => (
        <button
          className={`${item.variant} ${activeCommand === item.value ? "active" : ""}`}
          key={item.value}
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
