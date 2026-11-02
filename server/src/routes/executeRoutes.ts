import { Router, Response } from 'express';
import { z } from 'zod';
import { spawn, ChildProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { authMiddleware, AuthenticatedRequest } from '../middleware/authMiddleware';
import { executionLimiter } from '../middleware/rateLimiter';
import { AppError } from '../middleware/errorHandler';
import { SUPPORTED_LANGUAGES, config } from '../config/index';
import { supabaseAdmin } from '../config/supabase';
import { emitExecutionOutput } from '../services/socketService';
import { SupportedLanguage, ExecutionStatus } from '../types/index';
import * as storageService from '../services/storageService';
import { getProjectAccess } from '../services/projectAccessService';

const router = Router();

// Track active executions (supports both ChildProcess and AbortController)
interface ActiveExecution {
    userId: string;
    process?: ChildProcess;
    abortController?: AbortController;
}
const activeExecutions = new Map<string, ActiveExecution>();

router.use(authMiddleware);

const executeSchema = z.object({
    projectId: z.string().uuid(),
    filePath: z.string().min(1).transform(s => s.trim()),
    language: z.enum(['c', 'cpp', 'java', 'python', 'javascript', 'typescript', 'go', 'rust', 'php', 'ruby', 'bash']),
    stdin: z.string().optional()
});

// Judge0 Official Language IDs
const JUDGE0_LANGUAGES: Record<SupportedLanguage, number> = {
    c: 50,          // C (GCC 9.2.0)
    cpp: 54,        // C++ (GCC 9.2.0)
    java: 62,       // Java (OpenJDK 13.0.1)
    python: 71,     // Python (3.8.1)
    javascript: 63, // JavaScript (Node.js 12.14.0)
    typescript: 74, // TypeScript (3.7.4)
    go: 60,         // Go (1.13.5)
    rust: 73,       // Rust (1.40.0)
    php: 68,        // PHP (7.4.1)
    ruby: 72,       // Ruby (2.7.0)
    bash: 46        // Bash (5.0.0)
};

/**
 * POST /api/execute
 * Execute code via Judge0 (in production) or Docker CLI (in local development)
 */
router.post('/', executionLimiter, async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { projectId, filePath, language, stdin } = executeSchema.parse(req.body);
        const executionId = uuidv4();
        const io = req.app.get('io');

        const langConfig = SUPPORTED_LANGUAGES[language as SupportedLanguage];
        if (!langConfig) {
            throw new AppError('Unsupported language', 400, 'UNSUPPORTED_LANGUAGE');
        }

        // Log execution start
        await supabaseAdmin.from('execution_logs').insert({
            id: executionId,
            project_id: projectId,
            user_id: req.user!.id,
            language,
            file_path: filePath,
            status: 'running'
        });

        // Send initial response
        res.json({
            success: true,
            data: {
                executionId,
                status: 'running'
            }
        });

        // Resolve project owner
        const access = await getProjectAccess(req.user!.id, projectId);
        if (!access.hasAccess) {
            throw new AppError('Access denied to this project', 403, 'FORBIDDEN');
        }
        const storageOwnerId = access.ownerId || req.user!.id;

        // Determine backend:
        // Default to 'docker' for local development, and 'judge0' for production (Render).
        const defaultBackend = (process.env.NODE_ENV === 'production' || process.env.RENDER) ? 'judge0' : 'docker';
        const backend = (process.env.EXECUTION_BACKEND || defaultBackend).toLowerCase();

        console.log(`[Execute] Routing execution ${executionId} to sandboxed backend: ${backend}`);

        if (backend === 'docker') {
            executeWithDockerCLI(
                executionId,
                req.user!.id,
                storageOwnerId,
                projectId,
                filePath,
                langConfig,
                stdin,
                io
            ).catch(console.error);
        } else {
            executeWithJudge0(
                executionId,
                req.user!.id,
                storageOwnerId,
                projectId,
                filePath,
                language as SupportedLanguage,
                stdin,
                io
            ).catch(console.error);
        }
    } catch (error) {
        next(error);
    }
});

/**
 * DELETE /api/execute/:executionId
 * Stop a running execution
 */
router.delete('/:executionId', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { executionId } = req.params;
        const execution = activeExecutions.get(executionId);

        if (!execution) {
            throw new AppError('Execution not found', 404, 'NOT_FOUND');
        }

        if (execution.userId !== req.user!.id) {
            throw new AppError('Access denied', 403, 'FORBIDDEN');
        }

        if (execution.process) {
            execution.process.kill('SIGTERM');
        }
        if (execution.abortController) {
            execution.abortController.abort();
        }
        activeExecutions.delete(executionId);

        // Update log
        await supabaseAdmin
            .from('execution_logs')
            .update({ status: 'error', error_output: 'Execution stopped by user' })
            .eq('id', executionId);

        res.json({ success: true, data: { message: 'Execution stopped' } });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/execute/:executionId
 * Get execution status
 */
router.get('/:executionId', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { executionId } = req.params;

        const { data: log, error } = await supabaseAdmin
            .from('execution_logs')
            .select('*')
            .eq('id', executionId)
            .eq('user_id', req.user!.id)
            .single();

        if (error || !log) {
            throw new AppError('Execution not found', 404, 'NOT_FOUND');
        }

        res.json({
            success: true,
            data: {
                executionId: log.id,
                status: log.status,
                exitCode: log.exit_code,
                executionTimeMs: log.execution_time_ms,
                memoryUsedMb: log.memory_used_mb,
                output: log.output,
                errorOutput: log.error_output
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * Execute code via Judge0 API (Production Sandboxed Runner)
 */
async function executeWithJudge0(
    executionId: string,
    userId: string,
    storageOwnerId: string,
    projectId: string,
    filePath: string,
    language: SupportedLanguage,
    stdin: string | undefined,
    io: any
): Promise<void> {
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    let status: ExecutionStatus = 'completed';

    const abortController = new AbortController();
    activeExecutions.set(executionId, { userId, abortController });

    const timeoutMs = 20_000;
    const timeoutTimer = setTimeout(() => {
        abortController.abort();
    }, timeoutMs);

    try {
        console.log(`[Judge0] Starting sandboxed execution ${executionId} for ${language} file: ${filePath}`);

        const targetBuffer = await storageService.downloadFile(storageOwnerId, projectId, filePath);
        const sourceCode = targetBuffer.toString('utf-8');

        const languageId = JUDGE0_LANGUAGES[language];
        if (!languageId) {
            throw new Error(`Language '${language}' is not supported by Judge0.`);
        }

        const sourceCodeB64 = Buffer.from(sourceCode).toString('base64');
        const stdinB64 = stdin ? Buffer.from(stdin).toString('base64') : '';

        const apiUrl = (config.judge0.apiUrl || 'https://api.onlinecompiler.io/api/judge0').replace(/\/+$/, '');
        const apiKey = config.judge0.apiKey;
        const isRapidApi = apiUrl.includes('rapidapi.com');

        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };

        if (!apiKey) {
            throw new Error('Judge0 API key is not configured for production. Please add JUDGE0_API_KEY (from https://onlinecompiler.io for 100k free runs, or RapidAPI) to your Render environment variables.');
        }

        if (isRapidApi) {
            headers['X-RapidAPI-Key'] = apiKey;
            headers['X-RapidAPI-Host'] = config.judge0.apiHost || new URL(apiUrl).hostname;
        } else {
            headers['X-Auth-Token'] = apiKey;
            headers['Authorization'] = apiKey;
        }

        const response = await fetch(`${apiUrl}/submissions?base64_encoded=true&wait=true`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                source_code: sourceCodeB64,
                language_id: languageId,
                stdin: stdinB64,
                cpu_time_limit: 10,
                memory_limit: 128000
            }),
            signal: abortController.signal
        });

        clearTimeout(timeoutTimer);

        if (!response.ok) {
            const errText = await response.text();
            let msg = `Judge0 API error (${response.status}): ${errText.slice(0, 150)}`;
            if (response.status === 401 || response.status === 403) {
                msg = `Judge0 authentication failed (${response.status}). Please verify JUDGE0_API_KEY or JUDGE0_API_URL in Render environment variables.`;
            }
            throw new Error(msg);
        }

        const data: any = await response.json();

        const decodeB64 = (val?: string | null) => (val ? Buffer.from(val, 'base64').toString('utf-8') : '');

        const judgeStdout = decodeB64(data.stdout);
        const judgeStderr = decodeB64(data.stderr);
        const compileOutput = decodeB64(data.compile_output);
        const judgeMessage = decodeB64(data.message);

        const statusId = data.status?.id;

        if (compileOutput) {
            stderr += compileOutput;
            emitExecutionOutput(io, userId, executionId, 'stderr', compileOutput);
        }

        if (judgeStdout) {
            stdout += judgeStdout;
            emitExecutionOutput(io, userId, executionId, 'stdout', judgeStdout);
        }

        if (judgeStderr) {
            stderr += judgeStderr;
            emitExecutionOutput(io, userId, executionId, 'stderr', judgeStderr);
        }

        if (judgeMessage && !stderr.includes(judgeMessage)) {
            stderr += `\n${judgeMessage}`;
            emitExecutionOutput(io, userId, executionId, 'stderr', `\n${judgeMessage}`);
        }

        exitCode = data.exit_code ?? (statusId === 3 ? 0 : 1);

        if (statusId === 3) {
            status = 'completed';
        } else if (statusId === 5) {
            status = 'timeout';
            const timeoutMsg = '\nExecution timed out (Time Limit Exceeded)';
            stderr += timeoutMsg;
            emitExecutionOutput(io, userId, executionId, 'stderr', timeoutMsg);
        } else {
            status = 'error';
        }
    } catch (err: any) {
        clearTimeout(timeoutTimer);
        status = 'error';
        stderr = err.name === 'AbortError' ? 'Execution was cancelled or timed out' : (err.message || 'Execution failed');
        emitExecutionOutput(io, userId, executionId, 'stderr', stderr);
    } finally {
        activeExecutions.delete(executionId);
        const executionTime = Date.now() - startTime;

        await supabaseAdmin
            .from('execution_logs')
            .update({
                status,
                exit_code: exitCode,
                execution_time_ms: executionTime,
                output: stdout.slice(0, 10000),
                error_output: stderr.slice(0, 10000)
            })
            .eq('id', executionId);

        emitExecutionOutput(io, userId, executionId, 'status', status);
    }
}

/**
 * Execute code using Docker CLI (Local Sandboxed Development Runner)
 */
async function executeWithDockerCLI(
    executionId: string,
    userId: string,
    storageOwnerId: string,
    projectId: string,
    filePath: string,
    langConfig: typeof SUPPORTED_LANGUAGES['python'],
    stdin: string | undefined,
    io: any
): Promise<void> {
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    let status: ExecutionStatus = 'completed';
    let tempDir: string | null = null;

    try {
        console.log(`[Execute Docker] Starting sandboxed execution ${executionId} for ${filePath}`);
        tempDir = path.join(os.tmpdir(), `cloudcodex-${executionId}`);
        await fs.mkdir(tempDir, { recursive: true });

        const files = await storageService.listAllFilesRecursive(storageOwnerId, projectId, '', {
            excludeDirs: ['.git']
        });
        const sourceFiles = files.filter(f => !f.isDirectory);

        const BATCH_SIZE = 10;
        for (let i = 0; i < sourceFiles.length; i += BATCH_SIZE) {
            const batch = sourceFiles.slice(i, i + BATCH_SIZE);
            await Promise.allSettled(
                batch.map(async (file) => {
                    const buffer = await storageService.downloadFile(storageOwnerId, projectId, file.path);
                    const localFilePath = path.join(tempDir!, file.path);
                    await fs.mkdir(path.dirname(localFilePath), { recursive: true });
                    await fs.writeFile(localFilePath, buffer);
                })
            );
        }

        const fileName = filePath.split('/').pop() || filePath;
        const fileInContainer = `/code/${filePath}`;
        const className = fileName.replace(/\.[^.]+$/, '');
        const quotedFile = fileInContainer.replace(/'/g, "'\\''");

        let command = '';
        if (langConfig.compileCommand) {
            const compileCmd = langConfig.compileCommand
                .replace(/\/code\/main\.[a-z]+/g, `'${quotedFile}'`)
                .replace(/Main\.java/g, fileName);
            const runCmd = langConfig.runCommand.replace(/\bMain\b/g, className);
            command = `${compileCmd} && ${runCmd}`;
        } else {
            command = langConfig.runCommand.replace(/\/code\/main\.[a-z]+/g, `'${quotedFile}'`);
        }

        let dockerPath = tempDir;
        if (process.platform === 'win32') {
            dockerPath = tempDir.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
        }

        const memoryMb = parseInt(langConfig.memoryLimit);
        const dockerArgs = [
            'run',
            '--rm',
            '-i',
            '-e', 'PYTHONUNBUFFERED=1',
            '-v', `${dockerPath}:/code:ro`,
            '-w', '/code',
            '-m', `${memoryMb}m`,
            '--network', 'none',
            '--security-opt', 'no-new-privileges',
            langConfig.dockerImage,
            'sh', '-c', command
        ];

        const dockerProcess = spawn('docker', dockerArgs);
        activeExecutions.set(executionId, { process: dockerProcess, userId });

        if (stdin && stdin.trim()) {
            const stdinWithNewline = stdin.endsWith('\n') ? stdin : stdin + '\n';
            dockerProcess.stdin.write(stdinWithNewline);
        }
        dockerProcess.stdin.end();

        dockerProcess.stdout.on('data', (data: Buffer) => {
            const text = data.toString();
            stdout += text;
            emitExecutionOutput(io, userId, executionId, 'stdout', text);
        });

        dockerProcess.stderr.on('data', (data: Buffer) => {
            const text = data.toString();
            stderr += text;
            emitExecutionOutput(io, userId, executionId, 'stderr', text);
        });

        let isTimeout = false;
        const timeoutId = setTimeout(() => {
            isTimeout = true;
            dockerProcess.kill('SIGTERM');
            status = 'timeout';
            stderr += '\nExecution timed out';
        }, langConfig.timeout);

        exitCode = await new Promise<number>((resolve) => {
            dockerProcess.on('close', (code) => {
                clearTimeout(timeoutId);
                resolve(code ?? 1);
            });
            dockerProcess.on('error', (err) => {
                clearTimeout(timeoutId);
                stderr += `\nDocker process error: ${err.message}`;
                resolve(1);
            });
        });

        if (exitCode !== 0 && !isTimeout) {
            status = 'error';
        }
    } catch (error: any) {
        status = 'error';
        stderr = error.message;
        emitExecutionOutput(io, userId, executionId, 'stderr', stderr);
    } finally {
        activeExecutions.delete(executionId);
        const executionTime = Date.now() - startTime;

        if (tempDir) {
            await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        }

        await supabaseAdmin
            .from('execution_logs')
            .update({
                status,
                exit_code: exitCode,
                execution_time_ms: executionTime,
                output: stdout.slice(0, 10000),
                error_output: stderr.slice(0, 10000)
            })
            .eq('id', executionId);

        emitExecutionOutput(io, userId, executionId, 'status', status);
    }
}

export { router as executeRoutes };
