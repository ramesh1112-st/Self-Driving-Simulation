import { useEffect, useState } from "react";
import socket from "../socket";

function VideoFeed() {
  const [frame, setFrame] = useState("");

  useEffect(() => {
    socket.on("live_stream", (frameData) => {
      console.log("Frame arrived");
      setFrame(frameData);
    });

    return () => {
      socket.off("live_stream");
    };
  }, []);

  return (
    <div>
      <h2>Live Camera Feed</h2>

      {frame ? (
        <img
          src={frame}
          alt="Live Stream"
          width="700"
          style={{
            border: "2px solid white"
          }}
        />
      ) : (
        <p>Waiting for video...</p>
      )}
    </div>
  );
}

export default VideoFeed;