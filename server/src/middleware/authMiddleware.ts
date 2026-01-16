import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index';
import { supabaseAdmin } from '../config/supabase';
import { AppError } from './errorHandler';
import { User } from '../types/index';

export interface AuthenticatedRequest extends Request {
    user?: User;
}

/**
 * JWT Authentication Middleware
 * Validates the JWT token from Authorization header and attaches user to request
 */
export async function authMiddleware(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const authHeader = req.headers.authorization;
        let token: string | undefined;

        // Check Authorization header first
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        }
        // Fallback to query parameter (for file downloads via window.open)
        else if (req.query.token && typeof req.query.token === 'string') {
            token = req.query.token;
        }

        if (!token) {
            throw new AppError('No authorization token provided', 401, 'UNAUTHORIZED');
        }

        // Verify JWT token
        const decoded = jwt.verify(token, config.jwt.secret) as { sub: string; email: string };

        // Get user profile from Supabase
        const { data: profile, error } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', decoded.sub)
            .single();

        if (error || !profile) {
            throw new AppError('User not found', 401, 'UNAUTHORIZED');
        }

        // Attach user to request
        req.user = {
            id: profile.id,
            email: decoded.email,
            username: profile.username,
            role: profile.role,
            storageQuotaMb: profile.storage_quota_mb,
            storageUsedMb: profile.storage_used_mb,
            createdAt: new Date(profile.created_at)
        };

        next();
    } catch (error) {
        if (error instanceof jwt.JsonWebTokenError) {
            next(new AppError('Invalid token', 401, 'INVALID_TOKEN'));
        } else if (error instanceof jwt.TokenExpiredError) {
            next(new AppError('Token expired', 401, 'TOKEN_EXPIRED'));
        } else {
            next(error);
        }
    }
}

/**
 * Admin Role Middleware
 * Ensures the authenticated user has admin role
 */
export function adminMiddleware(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): void {
    if (!req.user || req.user.role !== 'admin') {
        next(new AppError('Admin access required', 403, 'FORBIDDEN'));
        return;
    }
    next();
}

/**
 * Optional Auth Middleware
 * Attaches user if token present, but doesn't require it
 */
export async function optionalAuthMiddleware(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        next();
        return;
    }

    try {
        await authMiddleware(req, res, next);
    } catch {
        // Silently continue without user
        next();
    }
}

