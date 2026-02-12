import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';

import { config } from './config/index';
import { authRoutes } from './routes/authRoutes';
import { projectRoutes } from './routes/projectRoutes';
import { fileRoutes } from './routes/fileRoutes';
import { executeRoutes } from './routes/executeRoutes';
import { gitRoutes } from './routes/gitRoutes';
import { zipRoutes } from './routes/zipRoutes';
import { adminRoutes } from './routes/adminRoutes';
import { profileRoutes } from './routes/profileRoutes';
import { errorHandler } from './middleware/errorHandler';
import { setupSocketHandlers } from './services/socketService';

const app = express();
const httpServer = createServer(app);

// Socket.IO setup
const io = new SocketIOServer(httpServer, {
    cors: {
        origin: config.frontend.url,
        methods: ['GET', 'POST'],
        credentials: true
    }
});

// Security middleware
app.use(helmet());
app.use(cors({
    origin: config.frontend.url,
    credentials: true
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/execute', executeRoutes);
app.use('/api/git', gitRoutes);
app.use('/api/zip', zipRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/profile', profileRoutes);

// ── Static file serving (landing page + client SPA) ──────────────────────
const landingDir = path.resolve(__dirname, '../../landing');
const clientDistDir = path.resolve(__dirname, '../../client/dist');

// Serve landing page assets (style.css, script.js, etc.)
app.use('/landing', express.static(landingDir));

// Serve Vite-built client assets
if (fs.existsSync(clientDistDir)) {
    app.use(express.static(clientDistDir));
}

// Landing page at root and /landing
app.get(['/', '/landing'], (_req, res) => {
    res.sendFile(path.join(landingDir, 'index.html'));
});

// All other non-API routes → client SPA (handles /login, /dashboard, etc.)
app.get('*', (req, res, next) => {
    // Skip API routes and socket.io
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
        return next();
    }
    const clientIndex = path.join(clientDistDir, 'index.html');
    if (fs.existsSync(clientIndex)) {
        res.sendFile(clientIndex);
    } else {
        // In development, proxy handles this; only relevant for production
        res.redirect(config.frontend.url + req.originalUrl);
    }
});

// Error handling
app.use(errorHandler);

// Setup WebSocket handlers
setupSocketHandlers(io);

// Make io available to routes
app.set('io', io);

// Start server
const PORT = config.server.port;

httpServer.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   ☁️  CloudCodeX Server                                   ║
║                                                           ║
║   Server running at http://localhost:${PORT}               ║
║   Environment: ${config.server.nodeEnv.padEnd(40)}║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

export { app, io };

