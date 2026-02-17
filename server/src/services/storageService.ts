import { supabase, supabaseAdmin } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';
import AdmZip from 'adm-zip';
import path from 'path';

/**
 * Supabase Storage Service
 * Centralized module for all cloud storage operations
 */

const BUCKET_NAME = 'project-files';
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

interface FileMetadata {
    size?: number;
    eTag?: string;
    cacheControl?: string;
    contentType?: string;
}

interface FileInfo {
    name: string;
    path: string;
    size: number;
    isDirectory: boolean;
    createdAt: Date;
    updatedAt: Date;
    metadata?: FileMetadata;
}

/**
 * Retry wrapper for storage operations
 */
async function withRetry<T>(
    operation: () => Promise<T>,
    retries: number = MAX_RETRIES,
    delay: number = RETRY_DELAY
): Promise<T> {
    try {
        return await operation();
    } catch (error: any) {
        if (retries > 0 && (error.message?.includes('network') || error.message?.includes('timeout'))) {
            await new Promise(resolve => setTimeout(resolve, delay));
            return withRetry(operation, retries - 1, delay * 2); // Exponential backoff
        }
        throw error;
    }
}

/**
 * Get storage path for a file
 */
function getStoragePath(userId: string, projectId: string, filePath: string): string {
    // Normalize path separators and strip leading slashes
    const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    if (!normalizedPath) {
        return `${userId}/${projectId}`;
    }
    return `${userId}/${projectId}/${normalizedPath}`;
}

/**
 * Upload a single file to Supabase Storage
 */
export async function uploadFile(
    userId: string,
    projectId: string,
    filePath: string,
    buffer: Buffer
): Promise<void> {
    if (buffer.length > MAX_FILE_SIZE) {
        throw new AppError(
            `File size exceeds maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024} MB`,
            400,
            'FILE_TOO_LARGE'
        );
    }

    const storagePath = getStoragePath(userId, projectId, filePath);

    await withRetry(async () => {
        const { error } = await supabaseAdmin.storage
            .from(BUCKET_NAME)
            .upload(storagePath, buffer, {
                contentType: 'application/octet-stream',
                upsert: true // Overwrite if exists
            });

        if (error) {
            console.error('[Storage] Upload error:', error);
            throw new AppError(`Failed to upload file: ${error.message}`, 500, 'STORAGE_UPLOAD_FAILED');
        }
    });

    console.log(`[Storage] ✓ Uploaded: ${storagePath}`);
}

/**
 * Download a file from Supabase Storage
 */
export async function downloadFile(
    userId: string,
    projectId: string,
    filePath: string
): Promise<Buffer> {
    const storagePath = getStoragePath(userId, projectId, filePath);

    return await withRetry(async () => {
        const { data, error } = await supabaseAdmin.storage
            .from(BUCKET_NAME)
            .download(storagePath);

        if (error) {
            console.error('[Storage] Download error:', error);
            throw new AppError(`Failed to download file: ${error.message}`, 500, 'STORAGE_DOWNLOAD_FAILED');
        }

        if (!data) {
            throw new AppError('File not found', 404, 'FILE_NOT_FOUND');
        }

        const arrayBuffer = await data.arrayBuffer();
        return Buffer.from(arrayBuffer);
    });
}

/**
 * Delete a file from Supabase Storage
 */
export async function deleteFile(
    userId: string,
    projectId: string,
    filePath: string
): Promise<void> {
    const storagePath = getStoragePath(userId, projectId, filePath);

    await withRetry(async () => {
        const { error } = await supabaseAdmin.storage
            .from(BUCKET_NAME)
            .remove([storagePath]);

        if (error) {
            console.error('[Storage] Delete error:', error);
            throw new AppError(`Failed to delete file: ${error.message}`, 500, 'STORAGE_DELETE_FAILED');
        }
    });

    console.log(`[Storage] ✓ Deleted: ${storagePath}`);
}

/**
 * List files in a directory
 */
export async function listFiles(
    userId: string,
    projectId: string,
    directory: string = ''
): Promise<FileInfo[]> {
    // getStoragePath now correctly handles empty directory (no trailing slash)
    const prefix = getStoragePath(userId, projectId, directory);

    return await withRetry(async () => {
        const { data, error } = await supabaseAdmin.storage
            .from(BUCKET_NAME)
            .list(prefix, {
                limit: 1000,
                sortBy: { column: 'name', order: 'asc' }
            });

        if (error) {
            console.error('[Storage] List error:', error);
            throw new AppError(`Failed to list files: ${error.message}`, 500, 'STORAGE_LIST_FAILED');
        }

        const items = (data || []).map(item => {
            const itemPath = directory ? `${directory}/${item.name}` : item.name;

            // In Supabase Storage, folder prefixes have null/empty id and no metadata.
            // Files always have a non-null id with metadata (size, mimetype, etc).
            // Use loose equality (==) to catch both null and undefined for id.
            const isFolder = item.id == null
                || item.id === ''
                || (!item.metadata && !item.id)
                || (item.metadata && !item.metadata.size && !item.metadata.mimetype);

            return {
                name: item.name,
                path: itemPath,
                size: item.metadata?.size || 0,
                isDirectory: isFolder,
                createdAt: new Date(item.created_at),
                updatedAt: new Date(item.updated_at),
                metadata: item.metadata ? {
                    size: item.metadata.size,
                    eTag: item.metadata.eTag,
                    cacheControl: item.metadata.cacheControl,
                    contentType: item.metadata.mimetype
                } : undefined
            };
        });

        console.log(`[Storage] Listed ${items.length} items in "${directory}":`,
            items.map(i => `${i.name} (${i.isDirectory ? 'DIR' : 'FILE'})`));

        return items;
    });
}

/**
 * Delete an entire directory (recursively)
 */
export async function deleteDirectory(
    userId: string,
    projectId: string,
    directory: string
): Promise<void> {
    const prefix = getStoragePath(userId, projectId, directory);

    // List all files in directory
    const { data: files, error: listError } = await supabaseAdmin.storage
        .from(BUCKET_NAME)
        .list(prefix, { limit: 10000 });

    if (listError) {
        console.error('[Storage] List error (delete dir):', listError);
        throw new AppError(`Failed to list directory: ${listError.message}`, 500, 'STORAGE_LIST_FAILED');
    }

    if (!files || files.length === 0) {
        return; // Directory is empty or doesn't exist
    }

    // Delete all files
    const filePaths = files.map(file => `${prefix}/${file.name}`);

    await withRetry(async () => {
        const { error } = await supabaseAdmin.storage
            .from(BUCKET_NAME)
            .remove(filePaths);

        if (error) {
            console.error('[Storage] Delete directory error:', error);
            throw new AppError(`Failed to delete directory: ${error.message}`, 500, 'STORAGE_DELETE_FAILED');
        }
    });

    console.log(`[Storage] ✓ Deleted directory: ${prefix} (${filePaths.length} files)`);
}

/**
 * Move/rename a file
 */
export async function moveFile(
    userId: string,
    projectId: string,
    oldPath: string,
    newPath: string
): Promise<void> {
    const oldStoragePath = getStoragePath(userId, projectId, oldPath);
    const newStoragePath = getStoragePath(userId, projectId, newPath);

    await withRetry(async () => {
        const { error } = await supabaseAdmin.storage
            .from(BUCKET_NAME)
            .move(oldStoragePath, newStoragePath);

        if (error) {
            console.error('[Storage] Move error:', error);
            throw new AppError(`Failed to move file: ${error.message}`, 500, 'STORAGE_MOVE_FAILED');
        }
    });

    console.log(`[Storage] ✓ Moved: ${oldStoragePath} → ${newStoragePath}`);
}

/**
 * Upload a ZIP file and extract it to cloud storage
 */
export async function uploadProjectZip(
    userId: string,
    projectId: string,
    zipBuffer: Buffer
): Promise<void> {
    console.log(`[Storage] Extracting ZIP for project ${projectId}...`);

    const zip = new AdmZip(zipBuffer);
    const zipEntries = zip.getEntries();

    let uploadedCount = 0;

    for (const entry of zipEntries) {
        if (entry.isDirectory) {
            continue; // Skip directories, they're created implicitly
        }

        const fileBuffer = entry.getData();
        const filePath = entry.entryName.replace(/\\/g, '/');

        await uploadFile(userId, projectId, filePath, fileBuffer);
        uploadedCount++;
    }

    console.log(`[Storage] ✓ Uploaded ${uploadedCount} files from ZIP`);
}

/**
 * Download all project files and create a ZIP
 */
export async function downloadProjectZip(
    userId: string,
    projectId: string
): Promise<Buffer> {
    console.log(`[Storage] Creating ZIP for project ${projectId}...`);

    const files = await listAllFilesRecursive(userId, projectId, '');
    const zip = new AdmZip();

    for (const file of files) {
        if (file.isDirectory) {
            continue;
        }

        const buffer = await downloadFile(userId, projectId, file.path);
        zip.addFile(file.path, buffer);
    }

    console.log(`[Storage] ✓ Created ZIP with ${files.length} files`);
    return zip.toBuffer();
}

/**
 * Recursively list all files in a project
 */
export async function listAllFilesRecursive(
    userId: string,
    projectId: string,
    directory: string
): Promise<FileInfo[]> {
    const files = await listFiles(userId, projectId, directory);
    const allFiles: FileInfo[] = [];

    for (const file of files) {
        allFiles.push(file);

        if (file.isDirectory) {
            const subFiles = await listAllFilesRecursive(userId, projectId, file.path);
            allFiles.push(...subFiles);
        }
    }

    return allFiles;
}

/**
 * Recursively list all files with metadata (for change detection)
 * Same as listAllFilesRecursive but ensures metadata is included
 */
export async function listAllFilesWithMetadata(
    userId: string,
    projectId: string,
    directory: string
): Promise<FileInfo[]> {
    // Same implementation as listAllFilesRecursive
    // Metadata is already included in listFiles
    return listAllFilesRecursive(userId, projectId, directory);
}

/**
 * Delete an entire project from storage
 */
export async function deleteProject(
    userId: string,
    projectId: string
): Promise<void> {
    console.log(`[Storage] Deleting project ${projectId}...`);
    await deleteDirectory(userId, projectId, '');
    console.log(`[Storage] ✓ Project deleted`);
}

/**
 * Calculate storage usage for a user
 */
export async function getStorageUsage(userId: string): Promise<number> {
    const prefix = `${userId}/`;

    const { data: files, error } = await supabaseAdmin.storage
        .from(BUCKET_NAME)
        .list(prefix, { limit: 10000 });

    if (error) {
        console.error('[Storage] Error calculating storage:', error);
        return 0;
    }

    let totalBytes = 0;
    for (const file of files || []) {
        totalBytes += file.metadata?.size || 0;
    }

    return totalBytes;
}

/**
 * Ensure a project exists (create initial README if needed)
 */
export async function ensureProjectExists(
    userId: string,
    projectId: string,
    projectName: string
): Promise<void> {
    const readmeContent = `# ${projectName}\n\nCreated with CloudCodeX\n`;
    const readmeBuffer = Buffer.from(readmeContent);

    await uploadFile(userId, projectId, 'README.md', readmeBuffer);
    console.log(`[Storage] ✓ Project initialized: ${projectId}`);
}

/**
 * Check if a file exists
 */
export async function fileExists(
    userId: string,
    projectId: string,
    filePath: string
): Promise<boolean> {
    try {
        const storagePath = getStoragePath(userId, projectId, filePath);

        const { data, error } = await supabaseAdmin.storage
            .from(BUCKET_NAME)
            .list(path.dirname(storagePath), {
                search: path.basename(storagePath)
            });

        return !error && !!data && data.length > 0;
    } catch {
        return false;
    }
}
