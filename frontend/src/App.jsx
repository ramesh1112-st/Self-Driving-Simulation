import { useEffect, useState } from "react";
import socket from "./socket";
import ControlPanel from "./components/ControlPanel";
import "./App.css";

function App() {
  const [data, setData] = useState({});

  useEffect(() => {
    socket.on("ai_data", (msg) => {
      setData(msg);
    });

    return () => socket.off("ai_data");
  }, []);

  return (
    <div className="container">
      <h1 className="title gloe-text">🚘 Self Driving Dashboard</h1>

      <div className="top-section">
        {/* Video Feed */}
        <div className="card video-card">
          <h2>Live Camera</h2>
          <img
            src="http://localhost:5000/video_feed"
            alt="Live Feed"
            className="video-feed"
          />
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
      <          p>km/h</p>
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