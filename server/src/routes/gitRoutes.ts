import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import {
    validatePushPrerequisites,
    checkGitRepo,
    listRemotes,
    addRemote,
    removeRemote,
    initRepo,
    getStatus,
    stageFiles,
    commitChanges,
    pushToRemote,
    pullFromRemote,
    cloneRepo
} from '../controllers/gitController';

/**
 * Git Routes (Docker-based)
 * 
 * All routes delegate to the gitController, which runs git operations
 * inside a Docker container. No local git, no local file downloads.
 * Files live in Supabase Storage and are accessed by the container directly.
 */

const router = Router();

router.use(authMiddleware);

// ── Repository Setup ───────────────────────────────────────────────────────

/** POST /api/git/:projectId/init - Initialize a git repository */
router.post('/:projectId/init', initRepo);

/** POST /api/git/:projectId/clone - Clone a repository */
router.post('/:projectId/clone', cloneRepo);

// ── Validation & Status ────────────────────────────────────────────────────

/** GET /api/git/:projectId/validate - Validate all push prerequisites */
router.get('/:projectId/validate', validatePushPrerequisites);

/** GET /api/git/:projectId/check-repo - Check if directory is a Git repository */
router.get('/:projectId/check-repo', checkGitRepo);

/** GET /api/git/:projectId/status - Get git status */
router.get('/:projectId/status', getStatus);

// ── Remote Management ──────────────────────────────────────────────────────

/** GET /api/git/:projectId/remote - List all remotes */
router.get('/:projectId/remote', listRemotes);

/** POST /api/git/:projectId/remote - Add remote origin */
router.post('/:projectId/remote', addRemote);

/** DELETE /api/git/:projectId/remote - Remove remote */
router.delete('/:projectId/remote', removeRemote);

// ── Git Operations ─────────────────────────────────────────────────────────

/** POST /api/git/:projectId/add - Stage files */
router.post('/:projectId/add', stageFiles);

/** POST /api/git/:projectId/commit - Commit staged changes */
router.post('/:projectId/commit', commitChanges);

/** POST /api/git/:projectId/push - Push to remote */
router.post('/:projectId/push', pushToRemote);

/** POST /api/git/:projectId/pull - Pull from remote */
router.post('/:projectId/pull', pullFromRemote);

export { router as gitRoutes };
