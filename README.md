# CloudCodeX

CloudCodeX is a cloud-based, multi-language IDE with a React + Vite frontend and a Node.js + Express backend. It provides a Monaco-powered editor, project/file management, execution in Docker containers, and Git operations through a dedicated worker container. Authentication, profiles, and file storage integrate with Supabase.

## Features
- Multi-language code execution in isolated Docker containers (C, C++, Java, Python, JavaScript, TypeScript, Go, Rust, PHP, Ruby, Bash)
- Monaco editor UI with project/file management
- Real-time multi-user collaboration with live cursor presence, user selection, and jump-to-collaborator navigation
- Role-based access control (`owner`, `editor`, `viewer`) for shared workspaces
- Room management with shareable Room IDs and optional password protection
- File version history and snapshot management with point-in-time restore
- Real-time execution output and file updates via Socket.IO
- Git operations in a Docker worker container (clone, status, commit, push)
- Supabase Auth + Storage integration
- Admin and profile pages
- Landing page served at /landing in dev and production

## Real-time collaboration & room management
CloudCodeX includes built-in real-time collaboration and workspace sharing:
- **Live Presence & Cursors:** Collaborators are assigned distinct colors with active file badges in the header bar. Click any collaborator badge to immediately jump to their active file and cursor.
- **Role-Based Access Control:**
  - `owner`: Full control over project settings, collaborators, and room security.
  - `editor`: Can edit code, execute files, and create/manage version snapshots.
  - `viewer`: Read-only access to files and editor with visual indicator badges.
- **Room Sharing & Passwords:** Share projects via direct collaborator invites or generate a unique Room ID with an optional password. Other users can join directly from the dashboard via the "Join Room" modal.
- **Version History & Snapshots:** Capture named revisions or browse automatic snapshots for each file with diffing and instant restoration.

## Project structure
- client/ - React + Vite frontend
- server/ - Express + TypeScript backend
- landing/ - Static marketing/landing page
- docker/ - Dockerfiles for language runners and git worker
- workspaces/ - Local project workspaces (dev or legacy storage)
- supabase_schema.sql, supabase_storage_setup.sql, admin_schema_migration.sql, collaboration_schema_migration.sql - database and storage setup

## Prerequisites
- Node.js 18+
- Docker Engine (required for code execution and git worker)
- Supabase project (URL, anon key, service role key)
- Redis (docker-compose starts one for you)

## Quick start (local dev)
1. Install dependencies
	```bash
	npm run install:all
	```

2. Configure environment
	Create a .env file at the repo root or in server/.env. The server loads the first existing file from:
	- ENV_FILE (if set)
	- .env (repo root)
	- server/.env
	- server/.env (resolved from server build output)

3. Start dev servers
	```bash
	npm run dev
	```

	This starts:
	- Server: http://localhost:3001
	- Client: http://localhost:5173
	- Landing page: http://localhost:5173/landing

## Docker-compose (dev)
You can also run the server, client, and Redis via docker-compose:
```bash
docker-compose up --build
```

Note: language execution and git operations require their Docker images to be built separately. See the next section.

## Build execution images
Language and git worker images are defined in docker/languages. Use the helper scripts:
- Linux/macOS:
	```bash
	npm run docker:build-images:linux
	```
- Windows (PowerShell):
	```bash
	npm run docker:build-images:windows
	```

## Environment variables
Required for core functionality:
- SUPABASE_URL
- SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY
- JWT_SECRET (recommended for production)

Optional (OAuth):
- GITHUB_CLIENT_ID
- GITHUB_CLIENT_SECRET
- GITHUB_CALLBACK_URL (default http://localhost:3001/api/auth/github/callback)
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- GOOGLE_CALLBACK_URL (default http://localhost:3001/api/auth/google/callback)

Optional (SMTP):
- SMTP_HOST
- SMTP_PORT (default 587)
- SMTP_SECURE (true/false)
- SMTP_USER
- SMTP_PASS
- SMTP_FROM (default CloudCodeX <noreply@cloudcodex.com>)

Optional (Docker/runtime):
- DOCKER_SOCKET
- DOCKER_EXECUTION_TIMEOUT
- DOCKER_MEMORY_LIMIT
- DOCKER_CPU_LIMIT
- DOCKER_IMAGE_C_CPP
- DOCKER_IMAGE_JAVA
- DOCKER_IMAGE_PYTHON
- DOCKER_IMAGE_JAVASCRIPT
- DOCKER_IMAGE_GO
- DOCKER_IMAGE_RUST
- DOCKER_IMAGE_PHP
- DOCKER_IMAGE_RUBY
- DOCKER_IMAGE_BASH
- DOCKER_IMAGE_GIT_WORKER

Optional (storage + frontend):
- WORKSPACE_ROOT (default ./workspaces)
- MAX_ZIP_SIZE_MB
- MAX_STORAGE_PER_USER_MB
- FRONTEND_URL (default http://localhost:5173)

## Supabase setup
1. Run the SQL scripts in the Supabase SQL editor:
	- supabase_schema.sql
	- supabase_storage_setup.sql
	- admin_schema_migration.sql (if you need admin features)
	- collaboration_schema_migration.sql (for real-time collaboration, rooms & version history)

2. Make sure the Storage bucket project-files exists and RLS policies are configured.

For migrating local workspaces to Supabase Storage, see server/MIGRATION_GUIDE.md.

## Build for production
1. Build the client:
	```bash
	npm run build
	```

2. Build and start the server:
	```bash
	cd server
	npm run build
	npm run start
	```

The server serves:
- /landing from landing/
- the built client SPA from client/dist

## Scripts
Root scripts:
- npm run dev - run server and client in dev mode
- npm run install:all - install dependencies for root, server, and client
- npm run build - build the client
- npm run docker:build-images:linux - build Docker images on Linux/macOS
- npm run docker:build-images:windows - build Docker images on Windows

Server scripts (server/):
- npm run dev - start server with tsx
- npm run build - compile TypeScript
- npm run start - run compiled server
- npm run test - unit tests
- npm run test:integration - integration tests
- npm run lint - lint server code

Client scripts (client/):
- npm run dev - start Vite dev server
- npm run build - build client
- npm run preview - preview build
- npm run test - run Vitest
- npm run lint - lint client code

## Notes
- The frontend uses relative /api and /socket.io endpoints. In dev, Vite proxies those to the server.
- Real-time collaboration uses Socket.IO rooms scoped per project (`project:<projectId>`) for live cursor positions, file buffers, and active presence tracking.
- Git operations run inside a Docker worker container (cloudcodex-git-worker by default).
- Code execution runs in language-specific Docker containers defined in docker/languages.
