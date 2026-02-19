
                                       CloudCodeX
  student:aparna ashok
  email:aparnaa.mca2426@saintgits.org
  guide:Ms.Anoopa R

 The Online Multi-Language Code Compiler with Secure Sandbox Execution is a web-based platform designed to allow users to write, compile, and execute source code across multiple programming languages—including C, C++, Java, and Python—directly from a browser without requiring any local development setup. The system integrates a Node.js backend with a Docker-based sandbox environment to provide a secure and scalable execution framework for handling untrusted user programs.
Each submitted code snippet is executed within a lightweight, isolated container configured with strict limits on CPU usage, memory allocation, file system access, and execution time, thereby preventing potential security threats such as infinite loops, resource exhaustion, or malicious system-level operations. The platform supports real-time code execution, compilation error reporting, and output display, offering a user-friendly interface for learners and developers.
This solution is particularly valuable for online coding education platforms, technical assessments, laboratories, and interview practice, where secure, multi-language execution is required. By combining containerization, sandbox security, and web technologies, the system provides a robust, scalable, and highly accessible environment for learning and evaluating programming skills.


 Features

- *🔐 Secure Code Execution** - Docker-based sandboxed execution with resource limits
- *VS Code-like Editor** - Monaco Editor with syntax highlighting for 10+ languages
- * Multi-file Projects** - Full file system with nested folders
- * Real-time Output** - WebSocket-based streaming of execution results
- * Git Integration** - Clone, commit, push, and pull from GitHub
- * ZIP Import/Export** - Import local projects and export your work
- * Multi-user Support** - Supabase authentication with GitHub OAuth
- *Admin Dashboard** - Monitor usage, logs, and active containers



 Perequisites

- **Node.js**
- **React.js**
- **Docker** (Docker Desktop on Windows/Mac, Docker Engine on Linux)
- **Supabase** account (for auth and database)
- **Git** (optional, for git integration features)




