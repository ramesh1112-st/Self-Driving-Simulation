import { useEffect, useState } from "react";
import socket from "./socket";
import ControlPanel from "./components/ControlPanel";
import "./App.css";

function App() {
  const [data, setData] = useState({});
  const [frame, setFrame] = useState("");

  useEffect(() => {
    // Receive AI detection data
    socket.on("ai_data", (msg) => {
      setData(msg);
    });

    // Receive live video stream
    socket.on("live_stream", (frameData) => {
      console.log("Frame received in frontend");
      setFrame(frameData);
    });

    return () => {
      socket.off("ai_data");
      socket.off("live_stream");
    };
  }, []);

  return (
    <div className="container">
      <h1 className="title glow-text">🚘 Self Driving Dashboard</h1>

      <div className="top-section">
        
        {/* Video Feed */}
        <div className="card video-card">
          <h2>Live Camera</h2>

          {frame ? (
            <img
              src={frame}
              alt="Live Feed"
              className="video-feed"
            />
          ) : (
            <p>Waiting for video...</p>
          )}
        </div>

        {/* Status Panel */}
        <div className="card status-card">
          <h2>AI Status</h2>

          <div className="info-box">
            <p>Object</p>
            <h3>{data.object || "Waiting..."}</h3>
          </div>

          <div className="info-box">
            <p>Action</p>
            <h3 className={`action ${data.action?.toLowerCase()}`}>
              {data.action || "None"}
            </h3>
          </div>

          <div className="info-box">
            <p>Distance</p>
            <h3>{data.distance || "--"}</h3>
          </div>

          <div className="speedometer">
            <div className="outer-circle">
              <div className="inner-circle">
                <span>{data.speed || 20}</span>
                <p>km/h</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Manual Controls */}
      <div className="card control-card">
        <h2>Manual Control</h2>
        <ControlPanel />
      </div>
    </div>
  );
}

export default App;