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

const router = Router();

// Track active executions
const activeExecutions = new Map<string, { process: ChildProcess; userId: string }>();

router.use(authMiddleware);

const executeSchema = z.object({
    projectId: z.string().uuid(),
    filePath: z.string(),
    language: z.enum(['c', 'cpp', 'java', 'python', 'javascript', 'go', 'rust', 'php', 'ruby', 'bash']),
    stdin: z.string().optional()
});

/**
 * POST /api/execute
 * Execute code in a Docker container
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

        // Execute in background
        executeWithDockerCLI(
            executionId,
            req.user!.id,
            projectId,
            filePath,
            langConfig,
            stdin,
            io
        ).catch(console.error);
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

        execution.process.kill('SIGTERM');
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
 * Execute code using Docker CLI instead of Dockerode
 * This is more reliable on Windows
 */
async function executeWithDockerCLI(
    executionId: string,
    userId: string,
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
    let status: ExecutionStatus = 'completed' as ExecutionStatus;
    let tempDir: string | null = null;

    try {
        console.log(`[Execute] Starting execution ${executionId}`);
        console.log(`[Execute] Project: ${projectId}`);
        console.log(`[Execute] File: ${filePath}`);

        // Step 1: Create temporary directory for this execution
        tempDir = path.join(os.tmpdir(), `cloudcodex-${executionId}`);
        await fs.mkdir(tempDir, { recursive: true });
        console.log(`[Execute] Created temp directory: ${tempDir}`);

        // Step 2: Download project files from cloud storage (excluding .git)
        console.log(`[Execute] Downloading project files from cloud...`);
        const files = await storageService.listAllFilesRecursive(userId, projectId, '', {
            excludeDirs: ['.git']
        });
        const sourceFiles = files.filter(f => !f.isDirectory);
        console.log(`[Execute] Found ${sourceFiles.length} source files to download`);

        // Download files in parallel (batch of 10)
        let downloadedFiles = 0;
        const BATCH_SIZE = 10;
        for (let i = 0; i < sourceFiles.length; i += BATCH_SIZE) {
            const batch = sourceFiles.slice(i, i + BATCH_SIZE);
            const results = await Promise.allSettled(
                batch.map(async (file) => {
                    const buffer = await storageService.downloadFile(userId, projectId, file.path);
                    const localFilePath = path.join(tempDir!, file.path);
                    await fs.mkdir(path.dirname(localFilePath), { recursive: true });
                    await fs.writeFile(localFilePath, buffer);
                })
            );
            for (const r of results) {
                if (r.status === 'fulfilled') downloadedFiles++;
                else console.warn(`[Execute] Failed to download file:`, r.reason);
            }
        }
        console.log(`[Execute] Downloaded ${downloadedFiles} files to temp directory`);

        // Verify target file exists
        const verifyFiles = async (dir: string, prefix = ''): Promise<string[]> => {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            const result: string[] = [];
            for (const entry of entries) {
                const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
                if (entry.isDirectory()) {
                    result.push(...await verifyFiles(path.join(dir, entry.name), rel));
                } else {
                    result.push(rel);
                }
            }
            return result;
        };
        const tempFiles = await verifyFiles(tempDir!);

        if (!tempFiles.some(f => f.replace(/\\/g, '/') === filePath.replace(/\\/g, '/'))) {
            console.warn(`[Execute] Target file '${filePath}' not found after recursive listing. Attempting direct download...`);
            try {
                const buffer = await storageService.downloadFile(userId, projectId, filePath);
                const localFilePath = path.join(tempDir, filePath);
                await fs.mkdir(path.dirname(localFilePath), { recursive: true });
                await fs.writeFile(localFilePath, buffer);
                console.log(`[Execute] ✓ Direct download of '${filePath}' succeeded`);
            } catch (err) {
                console.error(`[Execute] ✗ Direct download of '${filePath}' also failed:`, err);
            }
        }

        // Step 3: Prepare Docker execution
        // Get the actual filename from the path
        const fileName = filePath.split('/').pop() || filePath;
        const fileInContainer = `/code/${filePath}`;

        // Build command with actual file path
        let command = '';
        if (langConfig.compileCommand) {
            // Replace placeholder paths in compile command
            const compileCmd = langConfig.compileCommand
                .replace(/\/code\/main\.[a-z]+/g, fileInContainer)
                .replace(/Main\.java/g, fileName);
            const runCmd = langConfig.runCommand;
            command = `${compileCmd} && ${runCmd}`;
        } else {
            // Replace placeholder paths in run command
            command = langConfig.runCommand.replace(/\/code\/main\.[a-z]+/g, fileInContainer);
        }

        // stdin will be piped directly to the Docker process below

        let dockerPath = tempDir!;  // Use temporary directory
        if (process.platform === 'win32') {
            // Convert backslashes to forward slashes
            dockerPath = tempDir!.replace(/\\/g, '/');
            // Convert drive letter: C:/... -> /c/...
            dockerPath = dockerPath.replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
        }

        const memoryMb = parseInt(langConfig.memoryLimit);

        console.log(`[Execute] Starting execution ${executionId}`);
        console.log(`[Execute] Docker path: ${dockerPath}`);
        console.log(`[Execute] File: ${filePath}`);
        console.log(`[Execute] Command: ${command}`);
        console.log(`[Execute] Image: ${langConfig.dockerImage}`);

        // Build docker run arguments
        const dockerArgs = [
            'run',
            '--rm',
            '-i', // Enable interactive mode for stdin
            '-v', `${dockerPath}:/code:ro`,
            '-w', '/code',
            '-m', `${memoryMb}m`,
            '--network', 'none',
            '--security-opt', 'no-new-privileges',
            langConfig.dockerImage,
            'sh', '-c', command
        ];

        console.log(`[Execute] Docker args: docker ${dockerArgs.join(' ')}`);

        // Spawn Docker process
        const dockerProcess = spawn('docker', dockerArgs);
        activeExecutions.set(executionId, { process: dockerProcess, userId });

        // Pipe stdin if provided
        if (stdin && stdin.trim()) {
            // Ensure stdin ends with newline for scanf/input functions
            const stdinWithNewline = stdin.endsWith('\n') ? stdin : stdin + '\n';
            console.log(`[Execute] Piping stdin: ${JSON.stringify(stdinWithNewline)}`);
            dockerProcess.stdin.write(stdinWithNewline);
            dockerProcess.stdin.end();
        }

        // Handle stdout
        dockerProcess.stdout.on('data', (data: Buffer) => {
            const text = data.toString();
            console.log(`[Execute] stdout: ${text}`);
            stdout += text;
            emitExecutionOutput(io, userId, executionId, 'stdout', text);
        });

        // Handle stderr
        dockerProcess.stderr.on('data', (data: Buffer) => {
            const text = data.toString();
            console.log(`[Execute] stderr: ${text}`);
            stderr += text;
            emitExecutionOutput(io, userId, executionId, 'stderr', text);
        });

        // Set up timeout
        const timeoutId = setTimeout(() => {
            console.log(`[Execute] Timeout reached, killing process...`);
            dockerProcess.kill('SIGTERM');
            status = 'timeout';
            stderr += '\nExecution timed out';
        }, langConfig.timeout);

        // Wait for process to finish
        exitCode = await new Promise<number>((resolve) => {
            dockerProcess.on('close', (code) => {
                console.log(`[Execute] Process exited with code: ${code}`);
                clearTimeout(timeoutId);
                resolve(code ?? 1);
            });

            dockerProcess.on('error', (err) => {
                console.error(`[Execute] Process error: ${err.message}`);
                clearTimeout(timeoutId);
                stderr += `\nProcess error: ${err.message}`;
                resolve(1);
            });
        });

        if (exitCode !== 0 && status !== 'timeout') {
            status = 'error';
        }
    } catch (error) {
        console.error(`[Execute] Error: ${(error as Error).message}`);
        status = 'error';
        stderr = (error as Error).message;
        emitExecutionOutput(io, userId, executionId, 'stderr', stderr);
    } finally {
        activeExecutions.delete(executionId);
        const executionTime = Date.now() - startTime;

        console.log(`[Execute] Execution finished. Status: ${status}, Time: ${executionTime}ms`);

        // Cleanup temporary directory
        if (tempDir) {
            try {
                await fs.rm(tempDir, { recursive: true, force: true });
                console.log(`[Execute] Cleaned up temp directory: ${tempDir}`);
            } catch (err) {
                console.error(`[Execute] Failed to cleanup temp directory:`, err);
            }
        }

        console.log(`[Execute] Execution finished. Status: ${status}, Time: ${executionTime}ms`);

        // Update execution log
        await supabaseAdmin
            .from('execution_logs')
            .update({
                status,
                exit_code: exitCode,
                execution_time_ms: executionTime,
                output: stdout.slice(0, 10000), // Limit stored output
                error_output: stderr.slice(0, 10000)
            })
            .eq('id', executionId);

        // Emit final status
        emitExecutionOutput(io, userId, executionId, 'status', status);
    }
}

export { router as executeRoutes };
