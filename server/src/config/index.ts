import dotenv from 'dotenv';
dotenv.config();

import { LanguageConfig, SupportedLanguage } from '../types/index';

export const SUPPORTED_LANGUAGES: Record<SupportedLanguage, LanguageConfig> = {
    c: {
        name: 'C',
        extension: '.c',
        dockerImage: 'cloudcodex-c-cpp',
        compileCommand: 'gcc -o /tmp/program /code/main.c',
        runCommand: '/tmp/program',
        timeout: 30000,
        memoryLimit: '256m'
    },
    cpp: {
        name: 'C++',
        extension: '.cpp',
        dockerImage: 'cloudcodex-c-cpp',
        compileCommand: 'g++ -o /tmp/program /code/main.cpp',
        runCommand: '/tmp/program',
        timeout: 30000,
        memoryLimit: '256m'
    },
    java: {
        name: 'Java',
        extension: '.java',
        dockerImage: 'cloudcodex-java',
        compileCommand: 'javac -d /tmp /code/Main.java',
        runCommand: 'java -cp /tmp Main',
        timeout: 30000,
        memoryLimit: '512m'
    },
    python: {
        name: 'Python',
        extension: '.py',
        dockerImage: 'cloudcodex-python',
        runCommand: 'python3 /code/main.py',
        timeout: 30000,
        memoryLimit: '256m'
    },
    javascript: {
        name: 'JavaScript',
        extension: '.js',
        dockerImage: 'cloudcodex-javascript',
        runCommand: 'node /code/main.js',
        timeout: 30000,
        memoryLimit: '256m'
    },
    go: {
        name: 'Go',
        extension: '.go',
        dockerImage: 'cloudcodex-go',
        compileCommand: 'go build -o /tmp/program /code/main.go',
        runCommand: '/tmp/program',
        timeout: 30000,
        memoryLimit: '256m'
    },
    rust: {
        name: 'Rust',
        extension: '.rs',
        dockerImage: 'cloudcodex-rust',
        compileCommand: 'rustc -o /tmp/program /code/main.rs',
        runCommand: '/tmp/program',
        timeout: 60000,
        memoryLimit: '512m'
    },
    php: {
        name: 'PHP',
        extension: '.php',
        dockerImage: 'cloudcodex-php',
        runCommand: 'php /code/main.php',
        timeout: 30000,
        memoryLimit: '256m'
    },
    ruby: {
        name: 'Ruby',
        extension: '.rb',
        dockerImage: 'cloudcodex-ruby',
        runCommand: 'ruby /code/main.rb',
        timeout: 30000,
        memoryLimit: '256m'
    },
    bash: {
        name: 'Bash',
        extension: '.sh',
        dockerImage: 'cloudcodex-bash',
        runCommand: 'bash /code/main.sh',
        timeout: 30000,
        memoryLimit: '128m'
    }
};

export const config = {
    server: {
        port: parseInt(process.env.PORT || '3001', 10),
        nodeEnv: process.env.NODE_ENV || 'development'
    },
    supabase: {
        url: process.env.SUPABASE_URL || '',
        anonKey: process.env.SUPABASE_ANON_KEY || '',
        serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    },
    jwt: {
        secret: process.env.JWT_SECRET || 'development-secret-change-in-production'
    },
    github: {
        clientId: process.env.GITHUB_CLIENT_ID || '',
        clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
        callbackUrl: process.env.GITHUB_CALLBACK_URL || 'http://localhost:3001/api/auth/github/callback'
    },
    docker: {
        socket: process.env.DOCKER_SOCKET || (process.platform === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock'),
        executionTimeout: parseInt(process.env.DOCKER_EXECUTION_TIMEOUT || '30000', 10),
        memoryLimit: process.env.DOCKER_MEMORY_LIMIT || '256m',
        cpuLimit: parseFloat(process.env.DOCKER_CPU_LIMIT || '0.5')
    },
    workspace: {
        root: process.env.WORKSPACE_ROOT || './workspaces',
        maxZipSizeMb: parseInt(process.env.MAX_ZIP_SIZE_MB || '100', 10),
        maxStoragePerUserMb: parseInt(process.env.MAX_STORAGE_PER_USER_MB || '500', 10)
    },
    frontend: {
        url: process.env.FRONTEND_URL || 'http://localhost:5173'
    }
};

