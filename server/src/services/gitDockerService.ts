import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import { config } from '../config';

/**
 * Git Docker Service
 * 
 * Orchestrates git operations by spinning up a Docker container (cloudcodex-git-worker)
 * that downloads project files from Supabase Storage, performs the git operation,
 * uploads results back, and returns a JSON result.
 * 
 * The server never runs git locally — all git operations happen inside Docker.
 */

const GIT_WORKER_IMAGE = 'cloudcodex-git-worker';
const GIT_OPERATION_TIMEOUT = 120_000; // 2 minutes
const MEMORY_LIMIT = '512m';

interface GitOperationResult {
    success: boolean;
    data?: any;
    error?: string;
}

/**
 * Run a git operation inside the Docker container
 */
export async function runGitOperation(
    operation: string,
    userId: string,
    projectId: string,
    operationData: Record<string, any> = {}
): Promise<GitOperationResult> {
    return new Promise((resolve, reject) => {
        const supabaseUrl = config.supabase.url;
        const supabaseServiceKey = config.supabase.serviceRoleKey;

        if (!supabaseUrl || !supabaseServiceKey) {
            return resolve({
                success: false,
                error: 'Server misconfigured: missing Supabase credentials'
            });
        }

        console.log(`[GitDocker] Starting operation: ${operation} for project ${projectId}`);

        const dockerArgs = [
            'run',
            '--rm',
            '-i',
            '-m', MEMORY_LIMIT,
            '--network', 'host', // Needs network to reach Supabase
            '--security-opt', 'no-new-privileges',
            '-e', `GIT_OPERATION=${operation}`,
            '-e', `USER_ID=${userId}`,
            '-e', `PROJECT_ID=${projectId}`,
            '-e', `GIT_OPERATION_DATA=${JSON.stringify(operationData)}`,
            '-e', `SUPABASE_URL=${supabaseUrl}`,
            '-e', `SUPABASE_SERVICE_KEY=${supabaseServiceKey}`,
            GIT_WORKER_IMAGE
        ];

        let stdout = '';
        let stderr = '';
        let timedOut = false;

        const proc = spawn('docker', dockerArgs, {
            timeout: GIT_OPERATION_TIMEOUT,
            windowsHide: true
        });

        const timer = setTimeout(() => {
            timedOut = true;
            proc.kill('SIGTERM');
            setTimeout(() => proc.kill('SIGKILL'), 5000);
        }, GIT_OPERATION_TIMEOUT);

        proc.stdout.on('data', (data: Buffer) => {
            stdout += data.toString();
        });

        proc.stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
            // Log worker stderr in real-time for debugging
            const lines = data.toString().split('\n').filter(Boolean);
            for (const line of lines) {
                console.log(`[GitWorker] ${line}`);
            }
        });

        proc.on('close', (code: number | null) => {
            clearTimeout(timer);

            if (timedOut) {
                return resolve({
                    success: false,
                    error: `Git operation timed out after ${GIT_OPERATION_TIMEOUT / 1000}s`
                });
            }

            // Parse result from stdout
            const result = parseWorkerOutput(stdout);

            if (result) {
                console.log(`[GitDocker] Operation ${operation} completed: success=${result.success}`);
                return resolve(result);
            }

            // If we couldn't parse output, fallback to exit code
            if (code === 0) {
                return resolve({
                    success: true,
                    data: { message: 'Operation completed', raw: stdout }
                });
            }

            console.error(`[GitDocker] Operation ${operation} failed with code ${code}`);
            return resolve({
                success: false,
                error: stderr || stdout || `Git operation failed with exit code ${code}`
            });
        });

        proc.on('error', (err: Error) => {
            clearTimeout(timer);
            console.error(`[GitDocker] Failed to spawn docker:`, err.message);
            return resolve({
                success: false,
                error: `Failed to start git container: ${err.message}`
            });
        });
    });
}

/**
 * Parse the structured output from the git worker container.
 * The worker wraps its JSON result between __GIT_RESULT_START__ and __GIT_RESULT_END__ markers.
 */
function parseWorkerOutput(stdout: string): GitOperationResult | null {
    const startMarker = '__GIT_RESULT_START__';
    const endMarker = '__GIT_RESULT_END__';

    const startIdx = stdout.indexOf(startMarker);
    const endIdx = stdout.indexOf(endMarker);

    if (startIdx === -1 || endIdx === -1) {
        return null;
    }

    const jsonStr = stdout.substring(startIdx + startMarker.length, endIdx).trim();

    try {
        return JSON.parse(jsonStr);
    } catch (e) {
        console.error('[GitDocker] Failed to parse worker output:', jsonStr);
        return null;
    }
}

/**
 * Check if the git worker Docker image is available
 */
export async function isGitWorkerAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
        const proc = spawn('docker', ['image', 'inspect', GIT_WORKER_IMAGE], {
            timeout: 10_000,
            windowsHide: true
        });

        proc.on('close', (code) => {
            resolve(code === 0);
        });

        proc.on('error', () => {
            resolve(false);
        });
    });
}
