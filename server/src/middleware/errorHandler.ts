import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '../types/index';

export class AppError extends Error {
    statusCode: number;
    code: string;

    constructor(message: string, statusCode: number = 500, code: string = 'INTERNAL_ERROR') {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}

export function errorHandler(
    err: Error | AppError,
    _req: Request,
    res: Response,
    _next: NextFunction
): void {
    console.error('Error:', err);

    const statusCode = err instanceof AppError ? err.statusCode : 500;
    const code = err instanceof AppError ? err.code : 'INTERNAL_ERROR';
    const message = err.message || 'An unexpected error occurred';

    const response: ApiResponse = {
        success: false,
        error: {
            code,
            message
        }
    };

    res.status(statusCode).json(response);
}

