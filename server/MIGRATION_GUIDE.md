# Data Migration Guide

## Migration Script: Local → Supabase Storage

This guide helps you migrate existing project files from local filesystem to Supabase Storage.

---

## Prerequisites

✅ **Before running migration:**
1. Supabase Storage bucket `project-files` is created
2. RLS policies are configured
3. Server is running and can connect to Supabase
4. You have a backup of your data (or use `--backup` flag)

---

## Usage

### 1. Dry Run (Test First)
**See what will be migrated without actually uploading:**
```bash
cd d:\p1\server
npx ts-node src/scripts/migrate_to_cloud.ts --dry-run
```

Expected output:
```
Found 3 users to migrate
👤 User: abc-123-def
  Found 5 projects
  📁 Project: project-1
    Found 12 files (2.5 MB)
    [DRY RUN] Would upload 12 files
...
Migration Summary
Files processed: 47
```

### 2. Migration with Backup (Recommended)
**Creates backup before migrating:**
```bash
npx ts-node src/scripts/migrate_to_cloud.ts --backup
```

This will:
- Create `./workspaces-backup-{timestamp}/` directory
- Copy all files to backup
- Then migrate to cloud storage

### 3. Direct Migration (No Backup)
**Only if you already have backups:**
```bash
npx ts-node src/scripts/migrate_to_cloud.ts
```

---

## What Gets Migrated

✅ **Included:**
- All project files (code, images, etc.)
- Directory structure is preserved
- `.gitignore`, `.gitkeep` files

❌ **Excluded (automatically skipped):**
- `node_modules/` directories
- `.git/` directories (but `.gitignore` is kept)
- `.DS_Store`, `Thumbs.db` (system files)

---

## Migration Process

```
For each user:
  For each project:
    1. Scan all files in project directory
    2. Upload each file to Supabase Storage
       Path: {user-id}/{project-id}/{file-path}
    3. Update user's storage quota in database
```

---

## Progress Tracking

During migration, you'll see:
```
👤 User: 550e8400-e29b-41d4-a716-446655440000
  Found 2 projects

  📁 Project: my-react-app
    Found 45 files (5.2 MB)
    Uploaded: 45/45
    ✅ Uploaded: 45/45 files
    💾 Updated storage quota: 5.2 MB

  📁 Project: python-backend
    Found 23 files (1.8 MB)
    Uploaded: 23/23
    ✅ Uploaded: 23/23 files
    💾 Updated storage quota: 7.0 MB
```

---

## After Migration

### Verify in Supabase
1. Go to Supabase Dashboard → **Storage** → **project-files**
2. You should see folders named with user IDs
3. Inside each: project folders with all files

### Test in Application
1. Try creating a new file
2. Try editing an existing file
3. Try running code execution
4. Check if file tree loads correctly

### Cleanup (Optional)
Once verified, you can delete local files:
```bash
# Windows
rd /s /q d:\p1\server\workspaces

# Or keep as backup and configure storage service only
```

---

## Troubleshooting

### "Bucket not found" Error
**Solution:** Create the bucket first:
```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('project-files', 'project-files', false, 52428800);
```

### "Permission denied" Error  
**Solution:** Check RLS policies are configured correctly. User must own the files.

### "Storage quota exceeded" Error
**Solution:** Increase user's quota in database:
```sql
UPDATE profiles 
SET storage_quota_mb = 1000 
WHERE id = 'user-id';
```

### Some Files Failed to Upload
- Check file size (max 50 MB per file)
- Check network connectivity to Supabase
- Retry failed files manually
- Check server logs for specific errors

---

## Migration Statistics

The script tracks:
- **Total users** migrated
- **Total projects** migrated
- **Total files** processed
- **Total data size** uploaded
- **Successful uploads** count
- **Failed uploads** count (with details)

Example output:
```
Migration Summary

Users migrated:       3
Projects migrated:    12
Files processed:      847
Files skipped:        45 (node_modules, .git)
Total data size:      156.8 MB

✅ Successful uploads: 847
❌ Failed uploads:     0

🎉 Migration completed! Files are now in Supabase Storage.
```

---

## Rollback Plan

If migration fails or you need to rollback:

1. **If you used `--backup` flag:**
   ```bash
   # Delete cloud files (via Supabase UI or API)
   # Restore from backup
   cp -r ./workspaces-backup-{timestamp}/* ./workspaces/
   ```

2. **If no backup:**
   - Files are still in local `./workspaces/`
   - Just delete cloud files and continue using local storage
   - Revert code changes from Git

---

## Performance

**Expected speeds** (depending on network):
- Upload: ~2-5 MB/s
- Small files (< 1 KB): ~10-20 files/second
- Large files (> 10 MB): ~30-60 seconds each

**Estimated time** for common scenarios:
- 100 files, 50 MB total: ~1-2 minutes
- 500 files, 200 MB total: ~5-10 minutes
- 1000+ files, 500 MB total: ~15-30 minutes

---

## Safety Features

✅ **The migration script:**
- Creates backups before migrating (if `--backup` flag used)
- Skips system files automatically
- Continues on errors (won't stop if one file fails)
- Updates storage quotas automatically
- Provides detailed progress and error logs
- Supports dry-run mode for testing

---

## Questions?

**Common scenarios:**

**Q: Can I run migration multiple times?**  
A: Yes! Files will be overwritten (upsert mode). Safe to retry.

**Q: What if migration is interrupted?**  
A: Re-run the script. Already uploaded files will be overwritten. No duplicates.

**Q: Can I migrate specific users only?**  
A: Edit the script to filter `userDirs` array by specific user IDs.

**Q: How do I revert to local storage?**  
A: Restore code from Git (before storage service changes). Files are still in `./workspaces/`.
