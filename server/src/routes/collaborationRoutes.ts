import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import {
    getCollaborators,
    inviteCollaborator,
    updateCollaboratorRole,
    removeCollaborator,
    getFileRevisions,
    createSnapshot,
    getRoomInfo,
    updateRoomPassword,
    joinRoom
} from '../controllers/collaborationController';

const router = Router();

router.use(authMiddleware);

// Join room by Room ID & Room Password
router.post('/join-room', joinRoom);

// Room ID & Password management
router.get('/:projectId/room-info', getRoomInfo);
router.put('/:projectId/room-password', updateRoomPassword);

// Collaborators management
router.get('/:projectId/collaborators', getCollaborators);
router.post('/:projectId/collaborators', inviteCollaborator);
router.patch('/:projectId/collaborators/:collaboratorId', updateCollaboratorRole);
router.delete('/:projectId/collaborators/:collaboratorId', removeCollaborator);

// Version history & snapshots
router.get('/:projectId/revisions', getFileRevisions);
router.post('/:projectId/revisions', createSnapshot);

export { router as collaborationRoutes };
