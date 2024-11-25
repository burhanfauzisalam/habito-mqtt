// Import dependencies
require('dotenv').config(); // Load environment variables
const express = require('express');
const bodyParser = require('body-parser');
const { Server } = require('socket.io');
const mqtt = require('mqtt');
const http = require('http');
const cors = require('cors');
const mysql = require('mysql2');
const createLightLogsTable = require("./createDB");
createLightLogsTable();

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
const MYSQL_CONFIG = {
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
};
const MQTT_BROKER = process.env.MQTT_BROKER;

// MySQL database connection
const db = mysql.createConnection(MYSQL_CONFIG);

db.connect((err) => {
    if (err) {
        console.error('Error connecting to MySQL database:', err);
    } else {
        console.log('Connected to MySQL database');
    }
});

// MQTT client setup
const mqttClient = mqtt.connect(MQTT_BROKER);
const MQTT_TOPICS = {
    STATUS: 'habito/status/#',
    LIGHT: 'habito/light/#',
};

// Track user status and timeouts
let userStatus = {};
let userTimeouts = {};

// Helper function: Mark user as offline
function setUserOffline(customId) {
    if (userStatus[customId]) {
        console.log(`User ${customId} marked as offline`);
        io.to(userStatus[customId]).emit('mqtt-data', { topic: MQTT_TOPICS.STATUS, message: 'OFFLINE' });
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

// Handle MQTT status messages
function handleStatusMessage(customId, payload) {
    if (userStatus[customId]) {
        io.to(userStatus[customId]).emit('mqtt-data', payload);
        console.log(`Status data sent to user: ${customId}`);

        // Reset user's timeout
        resetUserTimeout(customId);
    } else {
        console.log(`User with customId: ${customId} not found.`);
    }
}

// Handle MQTT light messages
function handleLightMessage(customId, payload) {
    const { topic, message } = payload;

    // Pecah topik untuk mendapatkan informasi
    const topicParts = topic.split('/');
    const color = topicParts[2] || 'unknown'; // Ambil bagian warna
    const username = topicParts[3] || `user_${customId}`; // Ambil bagian username
    const status = message.toString(); // Pesan diambil sebagai status (misalnya, "ON" atau "OFF")

    // Kirim data melalui WebSocket jika userStatus ditemukan
    if (userStatus[customId]) {
        io.to(userStatus[customId]).emit('light-data', { username, color, status });
        console.log(`Light data sent to user: ${customId}`);
    } else {
        console.log(`User with customId: ${customId} not found.`);
    }

    // Simpan data ke database
    const query = 'INSERT INTO light_logs (username, color, status) VALUES (?, ?, ?)';
    db.execute(query, [username, color, status], (err, results) => {
        if (err) {
            console.error('Database insert error:', err);
        } else {
            console.log(`Light log saved for username: ${username}, color: ${color}, status: ${status}`);
        }
    });
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

// WebSocket event listeners
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    let customId = null;

    socket.on('set-custom-id', (id) => {
        customId = id;
        userStatus[customId] = socket.id;
        console.log(`User ${customId} connected`);

        // Reset user's timeout
        resetUserTimeout(customId);
    });

    socket.emit('mqtt-data', { topic: MQTT_TOPICS.STATUS, message: 'OFFLINE' });

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
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const query = 'SELECT * FROM users WHERE username = ? AND password = ?';

    db.execute(query, [username, password], (err, results) => {
        if (err) {
            console.error('Database query error:', err);
            return res.status(500).send('Internal Server Error');
        }

        if (results.length > 0) {
            return res.json({ message: 'Login successful', user: results[0] });
        } else {
            return res.status(401).json({ message: 'Invalid username or password' });
        }
    });
});

// API endpoint: Check server status
app.get('/', (req, res) => {
    res.send('MQTT Backend is running');
});

// Start server
server.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
});
