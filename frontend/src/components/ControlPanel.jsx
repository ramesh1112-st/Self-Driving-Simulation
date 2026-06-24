import socket from "../socket";
import "./ControlPanel.css";

function ControlPanel() {
  const sendCommand = (cmd) => {
    socket.emit("control_command", cmd);
  };

  return (
    <div className="controls">
      <button onClick={() => sendCommand("STOP")}>STOP</button>
      <button onClick={() => sendCommand("LEFT")}>LEFT</button>
      <button onClick={() => sendCommand("RIGHT")}>RIGHT</button>
      <button onClick={() => sendCommand("AUTO")}>AUTO</button>
    </div>
  );
}

export default ControlPanel;