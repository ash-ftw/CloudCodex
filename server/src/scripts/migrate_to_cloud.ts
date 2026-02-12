import fs from 'fs/promises';
import path from 'path';
import { supabaseAdmin } from '../config/supabase';
import * as storageService from '../services/storageService';
import { config } from '../config/index';

/**
 * Migration Script: Local Filesystem → Supabase Storage
 * 
 * This script migrates all existing project files from local disk to cloud storage.
 * 
 * Usage:
 *   ts-node src/scripts/migrate_to_cloud.ts [--dry-run] [--backup]
 * 
 * Options:
 *   --dry-run   Show what would be migrated without actually uploading
 *   --backup    Create backup of workspaces directory before migration
 */

interface MigrationStats {
    totalUsers: number;
    totalProjects: number;
    totalFiles: number;
    totalBytes: number;
    successfulUploads: number;
    failedUploads: number;
    skippedFiles: number;
}

interface FileToMigrate {
    fullPath: string;
    relativePath: string;
    size: number;
}

const stats: MigrationStats = {
    totalUsers: 0,
    totalProjects: 0,
    totalFiles: 0,
    totalBytes: 0,
    successfulUploads: 0,
    failedUploads: 0,
    skippedFiles: 0
};

const SKIP_PATTERNS = [
    /node_modules/,
    /\.git$/,  // Skip .git directory but allow .gitignore, .gitkeep
    /\.DS_Store/,
    /Thumbs\.db/,
    /desktop\.ini/
];

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const shouldBackup = args.includes('--backup');

/**
 * Get all files recursively from a directory
 */
async function getAllFiles(dirPath: string, basePath: string): Promise<FileToMigrate[]> {
    const files: FileToMigrate[] = [];

    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            const relativePath = path.relative(basePath, fullPath).replace(/\\/g, '/');

            // Skip patterns
            if (SKIP_PATTERNS.some(pattern => pattern.test(relativePath))) {
                stats.skippedFiles++;
                continue;
            }

            if (entry.isDirectory()) {
                const subFiles = await getAllFiles(fullPath, basePath);
                files.push(...subFiles);
            } else if (entry.isFile()) {
                const stat = await fs.stat(fullPath);
                files.push({
                    fullPath,
                    relativePath,
                    size: stat.size
                });
            }
        }
    } catch (error) {
        console.warn(`⚠️  Could not read directory ${dirPath}:`, error);
    }

    return files;
}

/**
 * Create backup of workspaces directory
 */
async function createBackup(workspacesPath: string): Promise<void> {
    const backupPath = `${workspacesPath}-backup-${Date.now()}`;
    console.log(`\n📦 Creating backup: ${backupPath}`);

    try {
        await fs.cp(workspacesPath, backupPath, { recursive: true });
        console.log(`✅ Backup created successfully`);
    } catch (error) {
        console.error(`❌ Failed to create backup:`, error);
        throw error;
    }
}

/**
 * Migrate a single project
 */
async function migrateProject(
    userId: string,
    projectId: string,
    projectPath: string
): Promise<void> {
    console.log(`\n  📁 Project: ${projectId}`);

    // Get all files in project
    const files = await getAllFiles(projectPath, projectPath);
    stats.totalFiles += files.length;

    if (files.length === 0) {
        console.log(`    ⚠️  No files to migrate (empty project)`);
        return;
    }

    console.log(`    Found ${files.length} files (${formatBytes(files.reduce((sum, f) => sum + f.size, 0))})`);

    if (isDryRun) {
        console.log(`    [DRY RUN] Would upload ${files.length} files`);
        return;
    }

    // Upload each file
    let uploaded = 0;
    for (const file of files) {
        try {
            const buffer = await fs.readFile(file.fullPath);
            stats.totalBytes += buffer.length;

            await storageService.uploadFile(userId, projectId, file.relativePath, buffer);

            uploaded++;
            stats.successfulUploads++;

            // Progress indicator
            if (uploaded % 10 === 0) {
                process.stdout.write(`\r    Uploaded: ${uploaded}/${files.length}`);
            }
        } catch (error: any) {
            stats.failedUploads++;
            console.error(`\n    ❌ Failed to upload ${file.relativePath}:`, error.message);
        }
    }

    console.log(`\r    ✅ Uploaded: ${uploaded}/${files.length} files`);

    // Update user's storage quota in database
    try {
        const storageUsage = await storageService.getStorageUsage(userId);
        const usageMb = Math.round(storageUsage / (1024 * 1024) * 100) / 100;

        await supabaseAdmin
            .from('profiles')
            .update({ storage_used_mb: usageMb })
            .eq('id', userId);

        console.log(`    💾 Updated storage quota: ${usageMb} MB`);
    } catch (error) {
        console.warn(`    ⚠️  Could not update storage quota:`, error);
    }
}

/**
 * Migrate all projects for a user
 */
async function migrateUser(userId: string, userPath: string): Promise<void> {
    console.log(`\n👤 User: ${userId}`);

    const projectsPath = path.join(userPath, 'projects');

    // Check if projects directory exists
    try {
        await fs.access(projectsPath);
    } catch {
        console.log(`  ⚠️  No projects directory found, skipping user`);
        return;
    }

    // Get all projects
    const projects = await fs.readdir(projectsPath, { withFileTypes: true });
    const projectDirs = projects.filter(p => p.isDirectory());

    stats.totalProjects += projectDirs.length;
    console.log(`  Found ${projectDirs.length} projects`);

    // Migrate each project
    for (const project of projectDirs) {
        const projectPath = path.join(projectsPath, project.name);
        await migrateProject(userId, project.name, projectPath);
    }
}

/**
 * Main migration function
 */
async function migrate(): Promise<void> {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║  CloudCodeX: Local → Cloud Storage Migration              ║
╚════════════════════════════════════════════════════════════╝
`);

    if (isDryRun) {
        console.log(`🔍 DRY RUN MODE - No files will be uploaded\n`);
    }

    const workspacesPath = path.resolve(config.workspace.root);
    console.log(`📂 Workspaces directory: ${workspacesPath}\n`);

    // Check if workspaces directory exists
    try {
        await fs.access(workspacesPath);
    } catch {
        console.error(`❌ Workspaces directory not found: ${workspacesPath}`);
        console.error(`   Make sure you're running this from the server directory`);
        process.exit(1);
    }

    // Create backup if requested
    if (shouldBackup && !isDryRun) {
        await createBackup(workspacesPath);
    }

    // Get all users
    const users = await fs.readdir(workspacesPath, { withFileTypes: true });
    const userDirs = users.filter(u => u.isDirectory());

    stats.totalUsers = userDirs.length;
    console.log(`Found ${userDirs.length} users to migrate\n`);

    if (userDirs.length === 0) {
        console.log(`No users found. Nothing to migrate.`);
        return;
    }

    // Migrate each user
    for (const user of userDirs) {
        const userPath = path.join(workspacesPath, user.name);
        await migrateUser(user.name, userPath);
    }

    // Print summary
    printSummary();
}

/**
 * Print migration summary
 */
function printSummary(): void {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║  Migration Summary                                         ║
╚════════════════════════════════════════════════════════════╝

Users migrated:       ${stats.totalUsers}
Projects migrated:    ${stats.totalProjects}
Files processed:      ${stats.totalFiles}
Files skipped:        ${stats.skippedFiles}
Total data size:      ${formatBytes(stats.totalBytes)}

✅ Successful uploads: ${stats.successfulUploads}
❌ Failed uploads:     ${stats.failedUploads}
${isDryRun ? '\n🔍 DRY RUN - No actual uploads performed' : ''}
${stats.failedUploads > 0 ? '\n⚠️  Some files failed to upload. Check logs above for details.' : ''}
${stats.successfulUploads > 0 && !isDryRun ? '\n🎉 Migration completed! Files are now in Supabase Storage.' : ''}
`);

    if (!isDryRun && stats.successfulUploads > 0) {
        console.log(`
Next Steps:
1. Verify files in Supabase Dashboard → Storage → project-files
2. Test file operations in your application
3. Once verified, you can safely delete local workspaces:
   rm -rf ${config.workspace.root}
`);
    }
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * Handle errors and exit gracefully
 */
process.on('unhandledRejection', (error: any) => {
    console.error(`\n❌ Fatal error:`, error);
    printSummary();
    process.exit(1);
});

// Run migration
migrate()
    .then(() => {
        process.exit(stats.failedUploads > 0 ? 1 : 0);
    })
    .catch((error) => {
        console.error(`\n❌ Migration failed:`, error);
        process.exit(1);
    });
