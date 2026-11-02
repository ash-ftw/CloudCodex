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

// Piston API Language Configuration
const PISTON_LANGUAGES: Record<SupportedLanguage, { language: string; version: string }> = {
    c: { language: 'c', version: '10.2.0' },
    cpp: { language: 'c++', version: '10.2.0' },
    java: { language: 'java', version: '15.0.2' },
    python: { language: 'python', version: '3.10.0' },
    javascript: { language: 'javascript', version: '18.15.0' },
    typescript: { language: 'typescript', version: '5.0.3' },
    go: { language: 'go', version: '1.16.2' },
    rust: { language: 'rust', version: '1.50.0' },
    php: { language: 'php', version: '8.2.3' },
    ruby: { language: 'ruby', version: '3.0.1' },
    bash: { language: 'bash', version: '5.2.0' }
};

/**
 * POST /api/execute
 * Execute code via Piston API, Local native runner, or Docker CLI
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

        // Route to requested backend
        const backend = (process.env.EXECUTION_BACKEND || 'piston').toLowerCase();
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
        } else if (backend === 'local') {
            executeWithLocalProcess(
                executionId,
                req.user!.id,
                storageOwnerId,
                projectId,
                filePath,
                language as SupportedLanguage,
                stdin,
                io
            ).catch(console.error);
        } else {
            executeWithPiston(
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
 * Execute code via Piston API with automatic fallback to native local process runner
 */
async function executeWithPiston(
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

    const timeoutMs = 15_000;
    const timeoutTimer = setTimeout(() => {
        abortController.abort();
    }, timeoutMs);

    try {
        console.log(`[Piston] Starting execution ${executionId} for ${language} file: ${filePath}`);

        const targetBuffer = await storageService.downloadFile(storageOwnerId, projectId, filePath);
        const targetContent = targetBuffer.toString('utf-8');

        const pistonLangConfig = PISTON_LANGUAGES[language] || { language, version: '*' };
        const fileName = path.basename(filePath);

        const pistonFiles: Array<{ name: string; content: string }> = [
            { name: fileName, content: targetContent }
        ];

        try {
            const allFiles = await storageService.listAllFilesRecursive(storageOwnerId, projectId, '', {
                excludeDirs: ['.git', 'node_modules', '__pycache__', '.next', 'dist']
            });
            const secondaryFiles = allFiles
                .filter(f => !f.isDirectory && f.path !== filePath && (f.size || 0) < 50_000)
                .slice(0, 8);

            for (const file of secondaryFiles) {
                try {
                    const buf = await storageService.downloadFile(storageOwnerId, projectId, file.path);
                    pistonFiles.push({
                        name: file.path,
                        content: buf.toString('utf-8')
                    });
                } catch {}
            }
        } catch {}

        const pistonUrl = process.env.PISTON_API_URL || 'https://emkc.org/api/v2/piston/execute';
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (process.env.PISTON_API_KEY) {
            headers['Authorization'] = `Bearer ${process.env.PISTON_API_KEY}`;
        }

        const response = await fetch(pistonUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                language: pistonLangConfig.language,
                version: pistonLangConfig.version,
                files: pistonFiles,
                stdin: stdin || '',
                compile_timeout: 10000,
                run_timeout: 10000
            }),
            signal: abortController.signal
        });

        clearTimeout(timeoutTimer);

        if (!response.ok) {
            const errText = await response.text();
            console.warn(`[Piston] API returned ${response.status}: ${errText.slice(0, 120)}. Falling back to native local process runner...`);
            return executeWithLocalProcess(
                executionId,
                userId,
                storageOwnerId,
                projectId,
                filePath,
                language,
                stdin,
                io
            );
        }

        const data: any = await response.json();

        if (data.compile) {
            if (data.compile.stdout) {
                stdout += data.compile.stdout;
                emitExecutionOutput(io, userId, executionId, 'stdout', data.compile.stdout);
            }
            if (data.compile.stderr) {
                stderr += data.compile.stderr;
                emitExecutionOutput(io, userId, executionId, 'stderr', data.compile.stderr);
            }
            if (data.compile.code && data.compile.code !== 0) {
                exitCode = data.compile.code;
                status = 'error';
            }
        }

        if (data.run) {
            if (data.run.stdout) {
                stdout += data.run.stdout;
                emitExecutionOutput(io, userId, executionId, 'stdout', data.run.stdout);
            }
            if (data.run.stderr) {
                stderr += data.run.stderr;
                emitExecutionOutput(io, userId, executionId, 'stderr', data.run.stderr);
            }
            exitCode = data.run.code ?? (data.run.signal ? 1 : 0);

            if (data.run.signal === 'SIGKILL' || (data.run.output && data.run.output.includes('Time limit exceeded'))) {
                status = 'timeout';
                stderr += '\nExecution timed out';
                emitExecutionOutput(io, userId, executionId, 'stderr', '\nExecution timed out');
            } else if (exitCode !== 0 && status !== 'error') {
                status = 'error';
            } else if (exitCode === 0 && status !== 'error') {
                status = 'completed';
            }
        }
    } catch (err: any) {
        clearTimeout(timeoutTimer);

        if (err.name === 'AbortError') {
            status = 'timeout';
            stderr = 'Execution timed out or was cancelled by user';
            emitExecutionOutput(io, userId, executionId, 'stderr', stderr);
        } else {
            console.warn(`[Piston] Network/runtime error (${err.message}). Falling back to native local process runner...`);
            return executeWithLocalProcess(
                executionId,
                userId,
                storageOwnerId,
                projectId,
                filePath,
                language,
                stdin,
                io
            );
        }
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
 * Execute code using native host process with full stdin support
 */
async function executeWithLocalProcess(
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
    let tempDir: string | null = null;

    try {
        console.log(`[LocalRunner] Starting native execution ${executionId} for ${language} file: ${filePath}`);
        tempDir = path.join(os.tmpdir(), `cloudcodex-local-${executionId}`);
        await fs.mkdir(tempDir, { recursive: true });

        const targetBuffer = await storageService.downloadFile(storageOwnerId, projectId, filePath);
        const localTarget = path.join(tempDir, filePath);
        await fs.mkdir(path.dirname(localTarget), { recursive: true });
        await fs.writeFile(localTarget, targetBuffer);

        try {
            const files = await storageService.listAllFilesRecursive(storageOwnerId, projectId, '', {
                excludeDirs: ['.git', 'node_modules']
            });
            for (const f of files.filter(f => !f.isDirectory && f.path !== filePath && (f.size || 0) < 50_000).slice(0, 8)) {
                const b = await storageService.downloadFile(storageOwnerId, projectId, f.path);
                const lp = path.join(tempDir, f.path);
                await fs.mkdir(path.dirname(lp), { recursive: true });
                await fs.writeFile(lp, b);
            }
        } catch {}

        let cmd = '';
        let args: string[] = [];

        const workingDir = tempDir;

        if (language === 'c' || language === 'cpp') {
            const compiler = language === 'c' ? 'gcc' : 'g++';
            const binaryName = process.platform === 'win32' ? 'program.exe' : 'program.out';
            const binaryPath = path.join(workingDir, binaryName);
            const compileArgs = language === 'c'
                ? ['-O2', localTarget, '-o', binaryPath, '-lm']
                : ['-O2', '-std=c++17', localTarget, '-o', binaryPath, '-lm'];

            console.log(`[LocalRunner] Compiling ${language} with ${compiler}: ${compileArgs.join(' ')}`);

            const compileResult = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
                const compProc = spawn(compiler, compileArgs, { cwd: workingDir });
                activeExecutions.set(executionId, { userId, process: compProc });

                let compStderr = '';
                if (compProc.stderr) {
                    compProc.stderr.on('data', (d: Buffer) => {
                        const text = d.toString();
                        compStderr += text;
                        emitExecutionOutput(io, userId, executionId, 'stderr', text);
                    });
                }
                if (compProc.stdout) {
                    compProc.stdout.on('data', (d: Buffer) => {
                        const text = d.toString();
                        compStderr += text;
                        emitExecutionOutput(io, userId, executionId, 'stdout', text);
                    });
                }
                compProc.on('error', (err: Error) => {
                    resolve({ code: -1, stderr: `Compiler '${compiler}' error: ${err.message}` });
                });
                compProc.on('close', (code: number | null) => {
                    resolve({ code, stderr: compStderr });
                });
            });

            if (compileResult.code !== 0) {
                exitCode = compileResult.code || 1;
                status = 'error';
                stderr = compileResult.stderr || 'Compilation failed';
                return;
            }

            await fs.chmod(binaryPath, 0o755).catch(() => {});
            cmd = binaryPath;
            args = [];
        } else if (language === 'python') {
            cmd = process.platform === 'win32' ? 'python' : 'python3';
            args = ['-u', localTarget];
        } else if (language === 'javascript') {
            cmd = 'node';
            args = [localTarget];
        } else if (language === 'typescript') {
            cmd = 'npx';
            args = ['tsx', localTarget];
        } else if (language === 'bash') {
            cmd = 'bash';
            args = [localTarget];
        } else if (language === 'java') {
            cmd = 'java';
            args = [localTarget];
        } else if (language === 'go') {
            cmd = 'go';
            args = ['run', localTarget];
        } else if (language === 'rust') {
            const binaryName = process.platform === 'win32' ? 'program.exe' : 'program.out';
            const binaryPath = path.join(workingDir, binaryName);
            const compResult = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
                const compProc = spawn('rustc', ['-O', localTarget, '-o', binaryPath], { cwd: workingDir });
                activeExecutions.set(executionId, { userId, process: compProc });
                let compStderr = '';
                if (compProc.stderr) {
                    compProc.stderr.on('data', (d: Buffer) => { compStderr += d.toString(); });
                }
                compProc.on('error', (err: Error) => resolve({ code: -1, stderr: `rustc compiler error: ${err.message}` }));
                compProc.on('close', (code: number | null) => resolve({ code, stderr: compStderr }));
            });
            if (compResult.code !== 0) {
                exitCode = compResult.code || 1;
                status = 'error';
                stderr = compResult.stderr || 'Rust compilation failed';
                return;
            }
            await fs.chmod(binaryPath, 0o755).catch(() => {});
            cmd = binaryPath;
            args = [];
        } else {
            throw new Error(`Runtime for '${language}' is not installed locally. Please configure a custom PISTON_API_URL or run with Docker.`);
        }

        const proc = spawn(cmd, args, {
            cwd: workingDir,
            windowsHide: true,
            env: { ...process.env, PYTHONUNBUFFERED: '1' }
        });

        activeExecutions.set(executionId, { userId, process: proc });

        // Pipe stdin if provided, and always end stream to signal EOF
        if (stdin && stdin.trim()) {
            const stdinWithNewline = stdin.endsWith('\n') ? stdin : stdin + '\n';
            proc.stdin.write(stdinWithNewline);
        }
        proc.stdin.end();

        proc.stdout.on('data', (data: Buffer) => {
            const text = data.toString();
            stdout += text;
            emitExecutionOutput(io, userId, executionId, 'stdout', text);
        });

        proc.stderr.on('data', (data: Buffer) => {
            const text = data.toString();
            stderr += text;
            emitExecutionOutput(io, userId, executionId, 'stderr', text);
        });

        let isTimeout = false;
        const timer = setTimeout(() => {
            isTimeout = true;
            proc.kill('SIGTERM');
            stderr += '\nExecution timed out';
        }, 15000);

        exitCode = await new Promise<number>((resolve) => {
            proc.on('close', (code) => {
                clearTimeout(timer);
                resolve(code ?? 1);
            });
            proc.on('error', (err) => {
                clearTimeout(timer);
                stderr += `\nRuntime process error: ${err.message}`;
                resolve(1);
            });
        });

        status = isTimeout ? 'timeout' : (exitCode === 0 ? 'completed' : 'error');
    } catch (err: any) {
        status = 'error';
        stderr = err.message || 'Execution failed';
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

/**
 * Execute code using Docker CLI (Optional local development runner)
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
        console.log(`[Execute Docker] Starting execution ${executionId} for ${filePath}`);
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
                stderr += `\nProcess error: ${err.message}`;
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
