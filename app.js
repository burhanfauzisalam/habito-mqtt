// Import dependencies
require("dotenv").config(); // Load environment variables
const express = require("express");
const bodyParser = require("body-parser");
const { Server } = require("socket.io");
const mqtt = require("mqtt");
const http = require("http");
const cors = require("cors");
const { queryDatabase } = require("./db"); // Ganti dengan path ke file koneksi database
const createLightLogsTable = require("./createDB");
const createUsersTable = require("./usersDB");
const createUserLogsTable = require("./userLogsDB");

createLightLogsTable();
createUsersTable();
createUserLogsTable();

// App setup
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins for testing. Restrict this in production.
  },
});

// Load configuration from .env
const PORT = process.env.PORT || 3000;
const MQTT_BROKER = process.env.MQTT_BROKER;

// MQTT client setup
const mqttClient = mqtt.connect(MQTT_BROKER);
const MQTT_TOPICS = {
  STATUS: "habito/status/#", // example: habito/status/habito_001
  LIGHT: "habito/light/#", // example: habito/light/green/habito_001
};

// Track user status and timeouts
let userStatus = {};
let userTimeouts = {};

// Helper function: Save user log to database
async function saveUserLog(customId, newStatus) {
  const query = "INSERT INTO user_logs (custom_id, status) VALUES (?, ?)";
  try {
    await queryDatabase(query, [customId, newStatus]);
    console.log(`User log saved: customId=${customId}, status=${newStatus}`);
  } catch (err) {
    console.error("Database insert error for user log:", err);
  }
}

// Handle MQTT status messages
function handleStatusMessage(customId, payload) {
  const newStatus = payload.message.toString().toUpperCase(); // Status from MQTT payload

  if (
    !userStatus[customId] ||
    userStatus[customId].previousStatus !== newStatus
  ) {
    console.log(`Status change detected for ${customId}: ${newStatus}`);

    saveUserLog(customId, newStatus);

    if (!userStatus[customId]) {
      userStatus[customId] = {};
    }
    userStatus[customId].previousStatus = newStatus;
  } else {
    console.log(`No status change for ${customId}: ${newStatus}`);
  }

  if (userStatus[customId] && userStatus[customId].socketId) {
    io.to(userStatus[customId].socketId).emit("mqtt-data", payload);
  }

  resetUserTimeout(customId);
}

// Handle MQTT light messages
async function handleLightMessage(customId, payload) {
  const { topic, message } = payload;

  const topicParts = topic.split("/");
  const color = topicParts[2] || "unknown";
  const username = topicParts[3] || `user_${customId}`;
  const status = message.toString();

  if (userStatus[customId]) {
    io.to(userStatus[customId].socketId).emit("light-data", {
      username,
      color,
      status,
    });
    console.log(`Light data sent to user: ${customId}`);
  } else {
    console.log(`User with customId: ${customId} not found.`);
  }

  const checkQuery = `
        SELECT COUNT(*) AS count 
        FROM light_logs 
        WHERE username = ? 
          AND color = ? 
          AND DATE(time) = CURDATE()`;
  const insertQuery =
    "INSERT INTO light_logs (username, color, status) VALUES (?, ?, ?)";

  try {
    // Check if data with the same username, color, and today's date exists
    const result = await queryDatabase(checkQuery, [username, color]);
    const recordCount = result[0]?.count || 0;

    if (recordCount === 0) {
      // If no record exists, insert the new data
      await queryDatabase(insertQuery, [username, color, status]);
      console.log(
        `Light log saved for username: ${username}, color: ${color}, status: ${status}`
      );
    } else {
      console.log(
        `Duplicate record found for username: ${username}, color: ${color}. Skipping insert.`
      );
    }
  } catch (err) {
    console.error("Database error:", err);
  }
}

// Reset timeout for marking user offline
function resetUserTimeout(customId) {
  if (userTimeouts[customId]) {
    clearTimeout(userTimeouts[customId]);
  }
  userTimeouts[customId] = setTimeout(() => {
    setUserOffline(customId);
  }, 15000);
}

// Mark user as offline
function setUserOffline(customId) {
  if (userStatus[customId]) {
    const currentStatus = userStatus[customId].previousStatus;
    if (currentStatus !== "OFFLINE") {
      console.log(`User ${customId} marked as offline`);
      saveUserLog(customId, "OFFLINE");
      userStatus[customId].previousStatus = "OFFLINE";
      io.to(userStatus[customId].socketId).emit("mqtt-data", {
        topic: MQTT_TOPICS.STATUS,
        message: "OFFLINE",
      });
    }
  }
}

// MQTT event listeners
mqttClient.on("connect", () => {
  console.log("Connected to MQTT broker");
  mqttClient.subscribe(Object.values(MQTT_TOPICS), (err) => {
    if (!err) {
      console.log(`Subscribed to topics: ${Object.values(MQTT_TOPICS)}`);
    }
  });
});

mqttClient.on("message", (topic, message) => {
  const filterTopic = topic.split("/")[1];
  const customId = topic.split("/").pop();
  const payload = { topic, message: message.toString() };

  if (filterTopic === "status") {
    handleStatusMessage(customId, payload);
  } else if (filterTopic === "light") {
    handleLightMessage(customId, payload);
  }
});

// WebSocket event listeners
io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);
  let customId = null;

  socket.on("set-custom-id", (id) => {
    customId = id;
    if (!userStatus[customId]) {
      userStatus[customId] = {};
    }
    userStatus[customId].socketId = socket.id;
    console.log(`User ${customId} connected`);

    resetUserTimeout(customId);
  });

  socket.on("disconnect", () => {
    if (customId) {
      console.log(`User ${customId} disconnected`);
      delete userStatus[customId];
      clearTimeout(userTimeouts[customId]);
    }
  });
});

// Express middleware
app.use(cors());
app.use(bodyParser.json());

// API endpoint: User login
app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const query = "SELECT * FROM users WHERE username = ? AND password = ?";

  try {
    const results = await queryDatabase(query, [username, password]);
    if (results.length > 0) {
      return res.json({ message: "Login successful", user: results[0] });
    } else {
      return res.status(401).json({ message: "Invalid username or password" });
    }
  } catch (err) {
    console.error("Database query error:", err);
    return res.status(500).send("Internal Server Error");
  }
});

// API endpoint: Cek status lampu
app.get("/light-status", async (req, res) => {
  const { id } = req.query; // Use id instead of username or color

  if (!id) {
    return res.status(400).json({ message: "id is required" });
  }

  try {
    // Modify the query to filter based on customId
    const query =
      "SELECT * FROM light_logs WHERE username = ? AND DATE(time) = CURDATE()";
    const params = [id];

    const results = await queryDatabase(query, params);
    if (results.length > 0) {
      return res.json({ message: "Light status fetched", data: results });
    } else {
      return res
        .status(404)
        .json({ message: "No light status found for id " + id });
    }
  } catch (err) {
    console.error("Database query error:", err);
    return res.status(500).send("Internal Server Error");
  }
});

app.get("/reset-data", async (req, res) => {
  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ message: "id is required" });
  }

  try {
    const deleteQuery = "DELETE FROM light_logs WHERE username = ?";
    await queryDatabase(deleteQuery, [id]);

    return res.json({ message: `Data for id ${id} has been reset` });
  } catch (err) {
    console.error("Database query error:", err);
    return res.status(500).send("Internal Server Error");
  }
});

// API endpoint: Check server status
app.get("/", (req, res) => {
  res.send("MQTT Backend is running");
});

// Start server
server.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
