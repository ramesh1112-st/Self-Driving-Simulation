const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

let logs = [];

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  // Manual control
  socket.on("manual_control", (cmd) => {
    console.log("Manual command:", cmd);
    io.emit("control_command", cmd);
  });

  // Detection data
  socket.on("detection", (data) => {
    console.log("Detection:", data);

    logs.push(data);

    io.emit("ai_data", data);
  });

  // Video frames
  socket.on("video_frame", (frame) => {
    console.log("Frame received");

    io.emit("live_stream", frame);
  });

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);
  });
});

// Logs API
app.get("/logs", (req, res) => {
  res.json(logs);
});

app.get("/", (req, res) => {
  res.send("Backend running");
});

server.listen(5000, () => {
  console.log("Server running on port 5000");
});