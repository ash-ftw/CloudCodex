import { Router, Response } from 'express';
import { z } from 'zod';
import { spawn, ChildProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, AuthenticatedRequest } from '../middleware/authMiddleware';
import { executionLimiter } from '../middleware/rateLimiter';
import { AppError } from '../middleware/errorHandler';
import { getProjectPath } from '../utils/pathSecurity';
import { SUPPORTED_LANGUAGES, config } from '../config/index';
import { supabaseAdmin } from '../config/supabase';
import { emitExecutionOutput } from '../services/socketService';
import { SupportedLanguage, ExecutionStatus } from '../types/index';

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

        const projectPath = getProjectPath(req.user!.id, projectId);

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
            projectPath,
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
    projectPath: string,
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

    try {
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

        // If stdin is provided, pipe it to the command
        if (stdin && stdin.trim()) {
            // Escape special characters in stdin for shell
            const escapedStdin = stdin
                .replace(/\\/g, '\\\\')
                .replace(/'/g, "'\\''")
                .replace(/\n/g, '\\n');
            command = `printf '${escapedStdin}' | ${command}`;
        }

        // Convert Windows paths to Docker-compatible format
        // Windows: D:\p1\workspaces\... -> /d/p1/workspaces/...
        let dockerPath = projectPath;
        if (process.platform === 'win32') {
            // Convert backslashes to forward slashes
            dockerPath = projectPath.replace(/\\/g, '/');
            // Convert drive letter: D:/... -> /d/...
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
