import socket from "../socket";

function sendCommand(command) {
  socket.emit("manual_control", command);
}

function ControlPanel() {
  return (
    <div>
      <h2>Manual Control</h2>

      <button onClick={() => sendCommand("STOP")}>STOP</button>
      <button onClick={() => sendCommand("LEFT")}>LEFT</button>
      <button onClick={() => sendCommand("RIGHT")}>RIGHT</button>
      <button onClick={() => sendCommand("FORWARD")}>FORWARD</button>
    </div>
  );
}

export default ControlPanel;