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

// Store detection logs
let logs = [];

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  // Receive manual control from frontend
  socket.on("control_command", (cmd) => {
    console.log("Manual command:", cmd);

    // Send to Python AI
    io.emit("control_command", cmd);
  });

  // Receive detection data from Python
  socket.on("detection", (data) => {
    console.log("Detection:", data);

    // Save logs
    logs.push(data);

    // Send AI data to frontend
    io.emit("ai_data", data);
  });


  socket.on("ai_explanation", (data) => {
    console.log("AI Explanation:", data);
    io.emit("show_explanation", data);
  });


  // Receive video frame from Python
  socket.on("video_frame", (frame) => {
    console.log("Frame received");

    // Send live stream to frontend
    io.emit("live_stream", frame);
  });

  // Disconnect
  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);
  });
});

// API to fetch logs
app.get("/logs", (req, res) => {
  res.json(logs);
});

// Test route
app.get("/", (req, res) => {
  res.send("Backend running...");
});

// Start server
server.listen(5000, () => {
  console.log("Server running on port 5000");
});