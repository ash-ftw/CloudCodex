import dns from 'dns';
// Force IPv4-first DNS resolution to prevent IPv6 timeouts (cross-platform)
if (typeof dns.setDefaultResultOrder === 'function') {
    dns.setDefaultResultOrder('ipv4first');
}

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
import { collaborationRoutes } from './routes/collaborationRoutes';
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
app.use(helmet({
    hsts: false,
    crossOriginOpenerPolicy: false,
    originAgentCluster: false,
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
            imgSrc: ["'self'", "data:", "https:", "blob:"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net", "data:"],
            workerSrc: ["'self'", "blob:"],
            connectSrc: ["'self'", "ws:", "wss:", "https:", "http:"],
            upgradeInsecureRequests: null,
        }
    }
}));
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
app.use('/api/projects', collaborationRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/execute', executeRoutes);
app.use('/api/git', gitRoutes);
app.use('/api/zip', zipRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/profile', profileRoutes);

// Static file serving
const landingDir = path.resolve(__dirname, '../../landing');
const clientDistDir = path.resolve(__dirname, '../../client/dist');

app.use('/landing', express.static(landingDir));

if (fs.existsSync(clientDistDir)) {
    app.use(express.static(clientDistDir));
}

app.get(['/', '/landing'], (_req, res) => {
    res.sendFile(path.join(landingDir, 'index.html'));
});

app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
        return next();
    }
    const clientIndex = path.join(clientDistDir, 'index.html');
    if (fs.existsSync(clientIndex)) {
        res.sendFile(clientIndex);
    } else {
        res.redirect(config.frontend.url + req.originalUrl);
    }
});

app.use(errorHandler);

setupSocketHandlers(io);
app.set('io', io);

const PORT = config.server.port;

httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   ☁️  CodeSphere Server                                   ║
║                                                           ║
║   Server running at http://localhost:${PORT}               ║
║   Environment: ${config.server.nodeEnv.padEnd(40)}║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

export { app, io };
