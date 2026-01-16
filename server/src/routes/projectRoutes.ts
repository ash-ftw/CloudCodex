import { Router, Response } from 'express';
import { z } from 'zod';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { supabaseAdmin } from '../config/supabase';
import { authMiddleware, AuthenticatedRequest } from '../middleware/authMiddleware';
import { AppError } from '../middleware/errorHandler';
import { getProjectPath, getUserWorkspacePath } from '../utils/pathSecurity';
import { Project } from '../types/index';

const router = Router();

// Apply auth middleware to all routes
router.use(authMiddleware);

const createProjectSchema = z.object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    language: z.string().optional()
});

const updateProjectSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    language: z.string().optional()
});

/**
 * GET /api/projects
 * List all projects for the current user
 */
router.get('/', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { data: projects, error } = await supabaseAdmin
            .from('projects')
            .select('*')
            .eq('user_id', req.user!.id)
            .order('updated_at', { ascending: false });

        if (error) {
            console.error('Supabase error fetching projects:', error);
            throw new AppError(`Failed to fetch projects: ${error.message}`, 500, 'DB_ERROR');
        }

        res.json({
            success: true,
            data: projects.map((p: Record<string, unknown>) => ({
                id: p.id,
                name: p.name,
                description: p.description,
                language: p.language,
                githubUrl: p.github_url,
                createdAt: p.created_at,
                updatedAt: p.updated_at
            } as Project))
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/projects
 * Create a new project
 */
router.post('/', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { name, description, language } = createProjectSchema.parse(req.body);
        const projectId = uuidv4();

        // Create project in database
        const { data: project, error } = await supabaseAdmin
            .from('projects')
            .insert({
                id: projectId,
                user_id: req.user!.id,
                name,
                description,
                language
            })
            .select()
            .single();

        if (error) {
            throw new AppError('Failed to create project', 500, 'DB_ERROR');
        }

        // Create project directory with minimal structure
        const projectPath = getProjectPath(req.user!.id, projectId);
        await fs.mkdir(projectPath, { recursive: true });

        // Create initial README.md file
        await fs.writeFile(
            `${projectPath}/README.md`,
            `# ${name}\n\n${description || 'Project description'}\n`
        );

        res.status(201).json({
            success: true,
            data: {
                id: project.id,
                name: project.name,
                description: project.description,
                language: project.language,
                createdAt: project.created_at,
                updatedAt: project.updated_at
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/projects/:id/structure
 * Create full project structure (user-triggered)
 */
router.post('/:id/structure', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { id } = req.params;
        const { type = 'react' } = req.body;

        // Verify ownership
        const { data: project, error } = await supabaseAdmin
            .from('projects')
            .select('*')
            .eq('id', id)
            .eq('user_id', req.user!.id)
            .single();

        if (error || !project) {
            throw new AppError('Project not found', 404, 'NOT_FOUND');
        }

        const projectPath = getProjectPath(req.user!.id, id);

        // Create full project structure based on type
        if (type === 'react') {
            // React/TypeScript project structure
            await fs.mkdir(`${projectPath}/src/components`, { recursive: true });
            await fs.mkdir(`${projectPath}/src/hooks`, { recursive: true });
            await fs.mkdir(`${projectPath}/src/utils`, { recursive: true });

            // Create template files
            await fs.writeFile(`${projectPath}/src/components/App.tsx`,
                `import React from 'react';\n\nexport default function App() {\n  return <div>Hello World</div>;\n}\n`);

            await fs.writeFile(`${projectPath}/src/components/Header.tsx`,
                `import React from 'react';\n\nexport default function Header() {\n  return <header>My App</header>;\n}\n`);

            await fs.writeFile(`${projectPath}/src/hooks/useCustomHook.ts`,
                `import { useState } from 'react';\n\nexport function useCustomHook(initialValue: string) {\n  const [value, setValue] = useState(initialValue);\n  return { value, setValue };\n}\n`);

            await fs.writeFile(`${projectPath}/src/utils/helpers.ts`,
                `export function formatDate(date: Date): string {\n  return date.toLocaleDateString();\n}\n`);

            await fs.writeFile(`${projectPath}/package.json`,
                JSON.stringify({
                    name: project.name,
                    version: '1.0.0',
                    main: 'src/components/App.tsx'
                }, null, 2));
        }

        res.json({
            success: true,
            data: { message: 'Project structure created successfully' }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/projects/:id
 * Get a specific project
 */
router.get('/:id', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { id } = req.params;

        const { data: project, error } = await supabaseAdmin
            .from('projects')
            .select('*')
            .eq('id', id)
            .eq('user_id', req.user!.id)
            .single();

        if (error || !project) {
            throw new AppError('Project not found', 404, 'NOT_FOUND');
        }

        res.json({
            success: true,
            data: {
                id: project.id,
                name: project.name,
                description: project.description,
                language: project.language,
                githubUrl: project.github_url,
                createdAt: project.created_at,
                updatedAt: project.updated_at
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * PUT /api/projects/:id
 * Update a project
 */
router.put('/:id', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { id } = req.params;
        const updates = updateProjectSchema.parse(req.body);

        const { data: project, error } = await supabaseAdmin
            .from('projects')
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq('id', id)
            .eq('user_id', req.user!.id)
            .select()
            .single();

        if (error || !project) {
            throw new AppError('Project not found', 404, 'NOT_FOUND');
        }

        res.json({
            success: true,
            data: {
                id: project.id,
                name: project.name,
                description: project.description,
                language: project.language,
                updatedAt: project.updated_at
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * DELETE /api/projects/:id
 * Delete a project
 */
router.delete('/:id', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { id } = req.params;

        // Verify ownership
        const { data: project, error } = await supabaseAdmin
            .from('projects')
            .select('id')
            .eq('id', id)
            .eq('user_id', req.user!.id)
            .single();

        if (error || !project) {
            throw new AppError('Project not found', 404, 'NOT_FOUND');
        }

        // Delete from database
        await supabaseAdmin
            .from('projects')
            .delete()
            .eq('id', id);

        // Delete project directory
        const projectPath = getProjectPath(req.user!.id, id);
        await fs.rm(projectPath, { recursive: true, force: true });

        res.json({ success: true, data: { message: 'Project deleted' } });
    } catch (error) {
        next(error);
    }
});

// Helper function to get default main file content
function getDefaultMainFile(language: string): { filename: string; content: string } | null {
    const templates: Record<string, { filename: string; content: string }> = {
        python: {
            filename: 'main.py',
            content: '# CloudCodeX Python Project\n\nprint("Hello, World!")\n'
        },
        javascript: {
            filename: 'main.js',
            content: '// CloudCodeX JavaScript Project\n\nconsole.log("Hello, World!");\n'
        },
        c: {
            filename: 'main.c',
            content: '#include <stdio.h>\n\nint main() {\n    printf("Hello, World!\\n");\n    return 0;\n}\n'
        },
        cpp: {
            filename: 'main.cpp',
            content: '#include <iostream>\n\nint main() {\n    std::cout << "Hello, World!" << std::endl;\n    return 0;\n}\n'
        },
        java: {
            filename: 'Main.java',
            content: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}\n'
        },
        go: {
            filename: 'main.go',
            content: 'package main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Hello, World!")\n}\n'
        },
        rust: {
            filename: 'main.rs',
            content: 'fn main() {\n    println!("Hello, World!");\n}\n'
        },
        php: {
            filename: 'main.php',
            content: '<?php\n// CloudCodeX PHP Project\n\necho "Hello, World!\\n";\n'
        },
        ruby: {
            filename: 'main.rb',
            content: '# CloudCodeX Ruby Project\n\nputs "Hello, World!"\n'
        },
        bash: {
            filename: 'main.sh',
            content: '#!/bin/bash\n# CloudCodeX Bash Project\n\necho "Hello, World!"\n'
        }
    };

    return templates[language] || null;
}

export { router as projectRoutes };

