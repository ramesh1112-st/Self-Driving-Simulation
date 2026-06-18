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

  socket.on("detection", (data) => {
  console.log("Detection:", data);

  logs.push(data);

  // Send AI data to frontend dashboard
  io.emit("ai_data", {
    object: data.object,
    action: data.action,
    distance: data.distance,
    status: data.status
  });
});

  // Receive live video frame from Python
  socket.on("video_frame", (frame) => {
    console.log("Video frame received");
    // Forward live stream to frontend
    io.emit("live_stream", frame);
  });

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);
  });
});

// API route to fetch logs
app.get("/logs", (req, res) => {
  res.json(logs);
});

// Health check route
app.get("/", (req, res) => {
  res.send("Backend server is running");
});

server.listen(5000, () => {
  console.log("Server running on port 5000");
});