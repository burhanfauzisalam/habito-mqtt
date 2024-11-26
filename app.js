// Import dependencies
require('dotenv').config(); // Load environment variables
const express = require('express');
const bodyParser = require('body-parser');
const { Server } = require('socket.io');
const mqtt = require('mqtt');
const http = require('http');
const cors = require('cors');
const { queryDatabase } = require('./db'); // Ganti dengan path ke file koneksi database
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
        origin: '*', // Allow all origins for testing. Restrict this in production.
    },
});

// Load configuration from .env
const PORT = process.env.PORT || 3000;
const MQTT_BROKER = process.env.MQTT_BROKER;

// MQTT client setup
const mqttClient = mqtt.connect(MQTT_BROKER);
const MQTT_TOPICS = {
    STATUS: 'habito/status/#',
    LIGHT: 'habito/light/#',
};

// Track user status and timeouts
let userStatus = {};
let userTimeouts = {};

// Helper function: Save user log to database
async function saveUserLog(customId, newStatus) {
    const query = 'INSERT INTO user_logs (custom_id, status) VALUES (?, ?)';
    try {
        await queryDatabase(query, [customId, newStatus]);
        console.log(`User log saved: customId=${customId}, status=${newStatus}`);
    } catch (err) {
        console.error('Database insert error for user log:', err);
    }
}

// Handle MQTT status messages
function handleStatusMessage(customId, payload) {
    const newStatus = payload.message.toString(); // Status from MQTT payload

    // Check if the status is different from the previous one
    if (!userStatus[customId] || userStatus[customId].previousStatus !== newStatus) {
        console.log(`Status change detected for ${customId}: ${newStatus}`);
        
        // Save the new status log to the database
        saveUserLog(customId, newStatus);

        // Update user status
        if (!userStatus[customId]) {
            userStatus[customId] = {};
        }
        userStatus[customId].previousStatus = newStatus;
    } else {
        console.log(`No status change for ${customId}: ${newStatus}`);
    }

    // Send the status update to the WebSocket client if connected
    if (userStatus[customId] && userStatus[customId].socketId) {
        io.to(userStatus[customId].socketId).emit('mqtt-data', payload);
    }

    // Reset user's timeout
    resetUserTimeout(customId);
}

// Handle MQTT light messages
async function handleLightMessage(customId, payload) {
    const { topic, message } = payload;

    // Pecah topik untuk mendapatkan informasi
    const topicParts = topic.split('/');
    const color = topicParts[2] || 'unknown'; // Ambil bagian warna
    const username = topicParts[3] || `user_${customId}`; // Ambil bagian username
    const status = message.toString(); // Pesan diambil sebagai status (misalnya, "ON" atau "OFF")

    // Kirim data melalui WebSocket jika userStatus ditemukan
    if (userStatus[customId]) {
        io.to(userStatus[customId].socketId).emit('light-data', { username, color, status });
        console.log(`Light data sent to user: ${customId}`);
    } else {
        console.log(`User with customId: ${customId} not found.`);
    }

    // Simpan data ke database
    const query = 'INSERT INTO light_logs (username, color, status) VALUES (?, ?, ?)';
    try {
        await queryDatabase(query, [username, color, status]);
        console.log(`Light log saved for username: ${username}, color: ${color}, status: ${status}`);
    } catch (err) {
        console.error('Database insert error:', err);
    }
}

// Reset timeout for marking user offline
function resetUserTimeout(customId) {
    if (userTimeouts[customId]) {
        clearTimeout(userTimeouts[customId]);
    }
    userTimeouts[customId] = setTimeout(() => {
        setUserOffline(customId);
    }, 3000); // 3 seconds
}

// Mark user as offline
function setUserOffline(customId) {
    if (userStatus[customId]) {
        const currentStatus = userStatus[customId].previousStatus;
        if (currentStatus !== 'OFFLINE') {
            console.log(`User ${customId} marked as offline`);

            // Save the offline status to the database
            saveUserLog(customId, 'OFFLINE');

            // Update user status
            userStatus[customId].previousStatus = 'OFFLINE';

            // Notify the WebSocket client
            io.to(userStatus[customId].socketId).emit('mqtt-data', { topic: MQTT_TOPICS.STATUS, message: 'OFFLINE' });
        }
    }
}

// MQTT event listeners
mqttClient.on('connect', () => {
    console.log('Connected to MQTT broker');
    mqttClient.subscribe(Object.values(MQTT_TOPICS), (err) => {
        if (!err) {
            console.log(`Subscribed to topics: ${Object.values(MQTT_TOPICS)}`);
        }
    });
});

mqttClient.on('message', (topic, message) => {
    const filterTopic = topic.split('/')[1];
    const customId = topic.split('/').pop();
    const payload = { topic, message: message.toString() };

    if (filterTopic === 'status') {
        handleStatusMessage(customId, payload);
    } else if (filterTopic === 'light') {
        handleLightMessage(customId, payload);
    }
});

// WebSocket event listeners
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    let customId = null;

    socket.on('set-custom-id', (id) => {
        customId = id;
        if (!userStatus[customId]) {
            userStatus[customId] = {};
        }
        userStatus[customId].socketId = socket.id;
        console.log(`User ${customId} connected`);

        // Reset user's timeout
        resetUserTimeout(customId);
    });

    socket.on('disconnect', () => {
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
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const query = 'SELECT * FROM users WHERE username = ? AND password = ?';

    try {
        const results = await queryDatabase(query, [username, password]);
        if (results.length > 0) {
            return res.json({ message: 'Login successful', user: results[0] });
        } else {
            return res.status(401).json({ message: 'Invalid username or password' });
        }
    } catch (err) {
        console.error('Database query error:', err);
        return res.status(500).send('Internal Server Error');
    }
});

// API endpoint: Check server status
app.get('/', (req, res) => {
    res.send('MQTT Backend is running');
});

// Start server
server.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
});
