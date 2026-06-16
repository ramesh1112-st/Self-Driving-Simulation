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

    io.emit("update", data);
  });

  socket.on("frame", (frame) => {
    io.emit("video_frame", frame);
  });

  socket.on("disconnect", () => {
    console.log("Disconnected");
  });
});

app.get("/logs", (req, res) => {
  res.json(logs);
});

server.listen(5000, () => {
  console.log("Server running on port 5000");
});