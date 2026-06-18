import { useEffect, useState } from "react";
import socket from "../socket";

function VideoFeed() {
  const [frame, setFrame] = useState(null);

  useEffect(() => {
    socket.on("live_stream", (frameData) => {
      console.log("Frame received in frontend");
      setFrame(frameData);
    });

    return () => {
      socket.off("live_stream");
    };
  }, []);

  return (
    <div>
      <h2>Live Camera Feed</h2>

      {frame && (
        <img
          src={frame}
          alt="Live Stream"
          style={{
            width: "700px",
            border: "2px solid white"
          }}
        />
      )}
    </div>
  );
}

export default VideoFeed;