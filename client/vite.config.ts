import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

function serveLandingPage(): Plugin {
    const landingDir = path.resolve(__dirname, '../landing');
    const mimeTypes: Record<string, string> = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
    };
    return {
        name: 'serve-landing-page',
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                const url = req.url || '';
                if (url === '/landing' || url === '/landing/') {
                    const html = fs.readFileSync(path.join(landingDir, 'index.html'), 'utf-8');
                    res.setHeader('Content-Type', 'text/html');
                    res.end(html);
                    return;
                }
                if (url.startsWith('/landing/')) {
                    const filePath = path.join(landingDir, url.replace('/landing/', ''));
                    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
                        const ext = path.extname(filePath);
                        res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
                        fs.createReadStream(filePath).pipe(res);
                        return;
                    }
                }
                next();
            });
        }
    };
}

export default defineConfig({
    plugins: [serveLandingPage(), react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src')
        }
    },
    server: {
        port: 5173,
        proxy: {
            '/api': {
                target: 'http://localhost:3001',
                changeOrigin: true
            },
            '/socket.io': {
                target: 'http://localhost:3001',
                ws: true
            }
        }
    }
});
