import rateLimit from 'express-rate-limit';
import { AppError } from './errorHandler';

/**
 * General API rate limiter
 */
export const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per window
    message: 'Too many requests, please try again later',
    handler: (_req, _res, next) => {
        next(new AppError('Too many requests, please try again later', 429, 'RATE_LIMITED'));
    }
});

/**
 * Auth endpoints rate limiter (more strict)
 * NOTE: In production, consider reducing max to 5-10
 */
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50, // 50 auth attempts per window (increased for development)
    message: 'Too many authentication attempts',
    handler: (_req, _res, next) => {
        next(new AppError('Too many authentication attempts', 429, 'AUTH_RATE_LIMITED'));
    }
});

/**
 * Code execution rate limiter
 */
export const executionLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 executions per minute
    message: 'Too many code executions, please wait',
    handler: (_req, _res, next) => {
        next(new AppError('Too many code executions, please wait', 429, 'EXECUTION_RATE_LIMITED'));
    }
});

