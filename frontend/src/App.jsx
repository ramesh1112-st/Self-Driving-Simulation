import { useEffect, useState } from "react";
import socket from "./socket";

function App() {
  const [data, setData] = useState({});

  useEffect(() => {
    socket.on("ai_data", (msg) => {
      setData(msg);
    });
  }, []);

  return (
    <div>
      <img src="http://localhost:5000/video_feed" width="600" />
      <h2>Object: {data.object}</h2>
      <h2>Action: {data.action}</h2>
      <h2>Distance: {data.distance}</h2>
    </div>
  );
}

export default App;