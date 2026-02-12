import Dockerode from 'dockerode';
import { config } from '../config/index';

const docker = new Dockerode({ socketPath: config.docker.socket });

export interface ContainerInfo {
    id: string;
    name: string;
    image: string;
    status: string;
    state: string;
    created: Date;
    ports: Dockerode.Port[];
    labels: Record<string, string>;
    sizeRw?: number;
    sizeRootFs?: number;
}

export interface ContainerStats {
    id: string;
    name: string;
    cpuPercent: number;
    memoryUsageMb: number;
    memoryLimitMb: number;
    memoryPercent: number;
    networkRxMb: number;
    networkTxMb: number;
    pids: number;
}

export interface SystemResourceStats {
    containers: {
        total: number;
        running: number;
        paused: number;
        stopped: number;
    };
    images: number;
    cpuCount: number;
    totalMemoryMb: number;
    usedMemoryMb: number;
}

/**
 * Docker Monitoring Service
 * Provides container management and resource monitoring for admin module
 */
export class DockerMonitorService {
    /**
     * List all CloudCodeX containers
     */
    async listContainers(all = false): Promise<ContainerInfo[]> {
        try {
            const containers = await docker.listContainers({
                all,
                filters: {
                    label: ['cloudcodex=true']
                }
            });

            return containers.map((c) => ({
                id: c.Id.slice(0, 12),
                name: (c.Names[0] || '').replace(/^\//, ''),
                image: c.Image,
                status: c.Status,
                state: c.State,
                created: new Date(c.Created * 1000),
                ports: c.Ports,
                labels: c.Labels,
                sizeRw: (c as any).SizeRw,
                sizeRootFs: (c as any).SizeRootFs
            }));
        } catch (error) {
            console.error('Docker listContainers error:', error);
            return [];
        }
    }

    /**
     * Get live stats for a specific container
     */
    async getContainerStats(containerId: string): Promise<ContainerStats | null> {
        try {
            const container = docker.getContainer(containerId);
            const stats = await container.stats({ stream: false }) as any;
            return this.parseStats(containerId, stats);
        } catch (error) {
            console.error(`Docker stats error for ${containerId}:`, error);
            return null;
        }
    }

    /**
     * Get stats for all running CloudCodeX containers
     */
    async getAllContainerStats(): Promise<ContainerStats[]> {
        const containers = await this.listContainers(false);
        const statsPromises = containers.map(c => this.getContainerStats(c.id));
        const results = await Promise.allSettled(statsPromises);
        return results
            .filter((r): r is PromiseFulfilledResult<ContainerStats | null> => r.status === 'fulfilled')
            .map(r => r.value)
            .filter((s): s is ContainerStats => s !== null);
    }

    /**
     * Get system-level Docker resource stats
     */
    async getSystemStats(): Promise<SystemResourceStats> {
        try {
            const info = await docker.info();
            const containers = await docker.listContainers({ all: true, filters: { label: ['cloudcodex=true'] } });

            const running = containers.filter(c => c.State === 'running').length;
            const paused = containers.filter(c => c.State === 'paused').length;
            const stopped = containers.filter(c => c.State === 'exited' || c.State === 'dead').length;

            return {
                containers: {
                    total: containers.length,
                    running,
                    paused,
                    stopped
                },
                images: info.Images || 0,
                cpuCount: info.NCPU || 0,
                totalMemoryMb: Math.round((info.MemTotal || 0) / 1024 / 1024),
                usedMemoryMb: 0 // calculated from container stats
            };
        } catch (error) {
            console.error('Docker system stats error:', error);
            return {
                containers: { total: 0, running: 0, paused: 0, stopped: 0 },
                images: 0,
                cpuCount: 0,
                totalMemoryMb: 0,
                usedMemoryMb: 0
            };
        }
    }

    /**
     * Stop a container
     */
    async stopContainer(containerId: string): Promise<{ success: boolean; message: string }> {
        try {
            const container = docker.getContainer(containerId);
            await container.stop({ t: 5 });
            return { success: true, message: `Container ${containerId} stopped` };
        } catch (error: any) {
            return { success: false, message: error.message || 'Failed to stop container' };
        }
    }

    /**
     * Kill a container (force)
     */
    async killContainer(containerId: string): Promise<{ success: boolean; message: string }> {
        try {
            const container = docker.getContainer(containerId);
            await container.kill();
            return { success: true, message: `Container ${containerId} killed` };
        } catch (error: any) {
            return { success: false, message: error.message || 'Failed to kill container' };
        }
    }

    /**
     * Restart a container
     */
    async restartContainer(containerId: string): Promise<{ success: boolean; message: string }> {
        try {
            const container = docker.getContainer(containerId);
            await container.restart({ t: 5 });
            return { success: true, message: `Container ${containerId} restarted` };
        } catch (error: any) {
            return { success: false, message: error.message || 'Failed to restart container' };
        }
    }

    /**
     * Remove a container (force)
     */
    async removeContainer(containerId: string): Promise<{ success: boolean; message: string }> {
        try {
            const container = docker.getContainer(containerId);
            await container.remove({ force: true, v: true });
            return { success: true, message: `Container ${containerId} removed` };
        } catch (error: any) {
            return { success: false, message: error.message || 'Failed to remove container' };
        }
    }

    /**
     * Get container logs
     */
    async getContainerLogs(containerId: string, tail = 200): Promise<string> {
        try {
            const container = docker.getContainer(containerId);
            const logs = await container.logs({
                stdout: true,
                stderr: true,
                tail,
                timestamps: true
            });
            return logs.toString('utf-8');
        } catch (error: any) {
            return `Error fetching logs: ${error.message}`;
        }
    }

    /**
     * Pause a running container
     */
    async pauseContainer(containerId: string): Promise<{ success: boolean; message: string }> {
        try {
            const container = docker.getContainer(containerId);
            await container.pause();
            return { success: true, message: `Container ${containerId} paused` };
        } catch (error: any) {
            return { success: false, message: error.message || 'Failed to pause container' };
        }
    }

    /**
     * Unpause a paused container
     */
    async unpauseContainer(containerId: string): Promise<{ success: boolean; message: string }> {
        try {
            const container = docker.getContainer(containerId);
            await container.unpause();
            return { success: true, message: `Container ${containerId} unpaused` };
        } catch (error: any) {
            return { success: false, message: error.message || 'Failed to unpause container' };
        }
    }

    /**
     * Cleanup old/stuck containers (older than specified hours)
     */
    async cleanupOldContainers(maxAgeHours = 24): Promise<{ removed: number; errors: string[] }> {
        const cutoffTime = Date.now() - maxAgeHours * 60 * 60 * 1000;
        const containers = await this.listContainers(true);
        let removed = 0;
        const errors: string[] = [];

        for (const container of containers) {
            if (container.created.getTime() < cutoffTime) {
                const result = await this.removeContainer(container.id);
                if (result.success) {
                    removed++;
                } else {
                    errors.push(`${container.id}: ${result.message}`);
                }
            }
        }

        return { removed, errors };
    }

    /**
     * Parse raw Docker stats into a clean format
     */
    private parseStats(containerId: string, stats: any): ContainerStats {
        // CPU Calculation
        const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - (stats.precpu_stats?.cpu_usage?.total_usage || 0);
        const systemDelta = stats.cpu_stats.system_cpu_usage - (stats.precpu_stats?.system_cpu_usage || 0);
        const numCpus = stats.cpu_stats.online_cpus || stats.cpu_stats.cpu_usage?.percpu_usage?.length || 1;
        const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * numCpus * 100 : 0;

        // Memory Calculation
        const memUsage = stats.memory_stats?.usage || 0;
        const memLimit = stats.memory_stats?.limit || 0;
        const memCache = stats.memory_stats?.stats?.cache || 0;
        const memUsageMb = (memUsage - memCache) / 1024 / 1024;
        const memLimitMb = memLimit / 1024 / 1024;

        // Network
        let netRx = 0, netTx = 0;
        if (stats.networks) {
            for (const iface of Object.values(stats.networks) as any[]) {
                netRx += iface.rx_bytes || 0;
                netTx += iface.tx_bytes || 0;
            }
        }

        return {
            id: containerId,
            name: stats.name?.replace(/^\//, '') || containerId,
            cpuPercent: Math.round(cpuPercent * 100) / 100,
            memoryUsageMb: Math.round(memUsageMb * 100) / 100,
            memoryLimitMb: Math.round(memLimitMb * 100) / 100,
            memoryPercent: memLimitMb > 0 ? Math.round((memUsageMb / memLimitMb) * 10000) / 100 : 0,
            networkRxMb: Math.round(netRx / 1024 / 1024 * 100) / 100,
            networkTxMb: Math.round(netTx / 1024 / 1024 * 100) / 100,
            pids: stats.pids_stats?.current || 0
        };
    }
}

export const dockerMonitorService = new DockerMonitorService();
