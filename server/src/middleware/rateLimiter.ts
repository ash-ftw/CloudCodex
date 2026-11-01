import rateLimit from 'express-rate-limit';
import { AppError } from './errorHandler';

/**
 * Rate Limiting Middleware
 * 
 * Protects endpoints from brute force and denial of service.
 * Defaults to in-memory store for zero-config deployment.
 */

/**
 * General API rate limiter
 */
export const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per window
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many requests, please try again later',
    handler: (_req, _res, next) => {
        next(new AppError('Too many requests, please try again later', 429, 'RATE_LIMITED'));
    }
});

/**
 * Auth endpoints rate limiter (strict)
 * In production: 10 failed attempts per 15 minutes.
 * Successful logins/registrations do not consume limit.
 */
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.NODE_ENV === 'production' ? 10 : 50,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many authentication attempts',
    handler: (_req, _res, next) => {
        next(new AppError('Too many authentication attempts, please try again in 15 minutes', 429, 'AUTH_RATE_LIMITED'));
    }
});

/**
 * Code execution rate limiter
 */
export const executionLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 executions per minute
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many code executions, please wait',
    handler: (_req, _res, next) => {
        next(new AppError('Too many code executions, please wait', 429, 'EXECUTION_RATE_LIMITED'));
    }
});

/**
 * Git operations rate limiter
 */
export const gitLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 git operations per minute
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many git operations, please wait',
    handler: (_req, _res, next) => {
        next(new AppError('Too many git operations, please wait a minute', 429, 'GIT_RATE_LIMITED'));
    }
});
