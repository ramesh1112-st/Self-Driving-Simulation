import { useEffect, useState } from "react";
import socket from "./socket";
import ControlPanel from "./components/ControlPanel";
import "./App.css";

function App() {
  const [data, setData] = useState({});
  const [frame, setFrame] = useState("");

  useEffect(() => {
    socket.on("ai_data", (msg) => {
      setData(msg);
    });

    socket.on("live_stream", (frameData) => {
      setFrame(frameData);
    });

    return () => {
      socket.off("ai_data");
      socket.off("live_stream");
    };
  }, []);

  return (
    <div className="container">
      <h1 className="title">🚘 Self Driving Dashboard</h1>

      <div className="dashboard">

        {/* Video Section */}
        <div className="video-card">
          <h2>Live Camera</h2>
          <div className="video-wrapper">
            {frame ? (
              <img src={frame} alt="Live Feed" className="video-feed" />
            ) : (
              <p>Waiting for video...</p>
            )}
          </div>
        </div>

        {/* Status Section */}
        <div className="status-card">
          <h2>AI Status</h2>

          <div className="info-box">
            <p>Object</p>
            <h3>{data.object || "Waiting..."}</h3>
          </div>

          <div className="info-box">
            <p>Action</p>
            <h3>{data.action || "None"}</h3>
          </div>

          <div className="info-box">
            <p>Distance</p>
            <h3>{data.distance || "--"}</h3>
          </div>

          <div className="info-box">
            <p>Vehicle Status</p>
            <h3>{data.status || "Waiting..."}</h3>
          </div>

          <div className="speed-box">
            <h2>{data.speed || 0} km/h</h2>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="control-card">
        <h2>Manual Control</h2>
        <ControlPanel />
      </div>
    </div>
  );
}

export default App;