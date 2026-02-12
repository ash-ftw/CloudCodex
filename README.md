# CloudCodeX

☁️ A secure, cloud-based, multi-language online IDE and code execution platform similar to Replit or HackerRank.

![CloudCodeX](https://via.placeholder.com/800x400/0d1117/58a6ff?text=CloudCodeX+Cloud+IDE)

## ✨ Features

- **🔐 Secure Code Execution** - Docker-based sandboxed execution with resource limits
- **💻 VS Code-like Editor** - Monaco Editor with syntax highlighting for 10+ languages
- **📁 Multi-file Projects** - Full file system with nested folders
- **⚡ Real-time Output** - WebSocket-based streaming of execution results
- **🐙 Git Integration** - Clone, commit, push, and pull from GitHub
- **📦 ZIP Import/Export** - Import local projects and export your work
- **👥 Multi-user Support** - Supabase authentication with GitHub OAuth
- **🛡️ Admin Dashboard** - Monitor usage, logs, and active containers

## 🚀 Supported Languages

| Language | Version | Compiler/Runtime |
|----------|---------|------------------|
| C | - | GCC 12 |
| C++ | - | G++ 12 |
| Java | 17 | Eclipse Temurin |
| Python | 3.11 | CPython |
| JavaScript | 20 | Node.js |
| Go | 1.22 | Go |
| Rust | 1.75 | Rustc |
| PHP | 8.3 | PHP CLI |
| Ruby | 3.3 | Ruby |
| Bash | - | Bash |

## 📋 Prerequisites

- **Node.js** 18+ 
- **Docker** (Docker Desktop on Windows/Mac, Docker Engine on Linux)
- **Supabase** account (for auth and database)
- **Git** (optional, for git integration features)

## 🛠️ Installation

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/cloudcodex.git
cd cloudcodex
```

### 2. Configure Environment

Copy the example environment file and fill in your credentials:

```bash
cp .env.example server/.env
```

Edit `server/.env` with your Supabase and specific configuration (see `server/.env` for details).

### 3. Set Up Supabase Database

Run the contents of `supabase_schema.sql` in your Supabase SQL Editor to set up the necessary tables and security policies.

### 4. Build Docker Images

**Required for code execution features.**

**Windows:**
```powershell
./docker/build-images.ps1
```

**Mac/Linux:**
```bash
docker build -t cloudcodex-c-cpp ./docker/languages/c-cpp
docker build -t cloudcodex-python ./docker/languages/python
docker build -t cloudcodex-java ./docker/languages/java
docker build -t cloudcodex-javascript ./docker/languages/javascript
docker build -t cloudcodex-go ./docker/languages/go
docker build -t cloudcodex-rust ./docker/languages/rust
docker build -t cloudcodex-php ./docker/languages/php
docker build -t cloudcodex-ruby ./docker/languages/ruby
docker build -t cloudcodex-bash ./docker/languages/bash
```

### 5. Install Dependencies

Install all dependencies for both client and server from the root directory:

```bash
npm run install:all
```

### 6. Start Development Servers

Start both backend and frontend servers with a single command:

```bash
npm run dev
```

Access the application at: **http://localhost:5173**

## 📁 Project Structure

```
cloudcodex/
├── client/                 # React Frontend
│   ├── src/
│   │   ├── components/     # Reusable UI components
│   │   ├── pages/          # Page components
│   │   ├── store/          # Zustand state management
│   │   ├── services/       # API and socket services
│   │   └── styles/         # CSS stylesheets
│   └── package.json
│
├── server/                 # Node.js Backend
│   ├── src/
│   │   ├── controllers/    # Route handlers
│   │   ├── routes/         # Express routes
│   │   ├── services/       # Business logic
│   │   ├── middleware/     # Auth, rate limiting
│   │   ├── utils/          # Path security, helpers
│   │   └── config/         # Configuration
│   └── package.json
│
├── docker/                 # Docker Configuration
│   ├── languages/          # Per-language Dockerfiles
│   └── security/           # Seccomp profiles
│
├── workspaces/             # User workspaces (gitignored)
├── docker-compose.yml
└── README.md
```

## 🔒 Security Features

- **Path Traversal Protection** - All file paths are validated and sanitized
- **Symlink Prevention** - Symlinks are blocked to prevent escape attacks
- **Resource Limits** - CPU, memory, and time limits on execution
- **Network Isolation** - No network access from execution containers
- **Seccomp Profiles** - Restricted syscalls in containers
- **JWT Authentication** - Secure token-based sessions
- **Rate Limiting** - Protection against abuse

## 📡 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/register` | Register new user |
| `POST` | `/api/auth/login` | Login |
| `GET` | `/api/auth/github` | GitHub OAuth |
| `GET` | `/api/projects` | List projects |
| `POST` | `/api/projects` | Create project |
| `GET` | `/api/files/:projectId` | List files |
| `POST` | `/api/execute` | Execute code |
| `POST` | `/api/git/:projectId/clone` | Clone repo |
| `GET` | `/api/admin/usage` | Admin stats |

## 🧪 Testing

```bash
# Backend tests
cd server
npm test

# Frontend tests
cd client
npm test
```

## 🚀 Production Deployment

For production deployment:

1. Set `NODE_ENV=production`
2. Use proper SSL certificates
3. Configure a reverse proxy (nginx)
4. Set up Docker Swarm or Kubernetes for scaling
5. Configure proper logging and monitoring

## 📄 License

MIT License - see LICENSE file for details.

## 🤝 Contributing

Contributions are welcome! Please read the contributing guidelines first.

---

Built with ❤️ by CloudCodeX Team
