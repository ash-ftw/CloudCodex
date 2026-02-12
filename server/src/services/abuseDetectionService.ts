import { supabaseAdmin } from '../config/supabase';
import { dockerMonitorService } from './dockerMonitorService';
import { auditService } from './auditService';

/**
 * Abuse Detection Service
 * Monitors for suspicious activity and enforces resource limits
 */
export class AbuseDetectionService {
    /**
     * Check if a user has exceeded execution rate limits
     */
    async checkExecutionRate(userId: string, maxPerHour = 100): Promise<{
        exceeded: boolean;
        count: number;
        limit: number;
    }> {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

        const { count } = await supabaseAdmin
            .from('execution_logs')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .gte('created_at', oneHourAgo);

        return {
            exceeded: (count || 0) >= maxPerHour,
            count: count || 0,
            limit: maxPerHour
        };
    }

    /**
     * Detect users with abnormally high resource usage
     */
    async detectAbusePatterns(): Promise<Array<{
        userId: string;
        username: string;
        issue: string;
        severity: 'warning' | 'critical';
        details: Record<string, unknown>;
    }>> {
        const alerts: Array<{
            userId: string;
            username: string;
            issue: string;
            severity: 'warning' | 'critical';
            details: Record<string, unknown>;
        }> = [];

        // Get settings
        const settings = await this.getSettings();
        const maxExecPerHour = parseInt(settings.max_executions_per_hour || '100');

        // Check for excessive executions in the last hour
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

        const { data: heavyUsers } = await supabaseAdmin
            .from('execution_logs')
            .select('user_id, profiles(username)')
            .gte('created_at', oneHourAgo);

        if (heavyUsers) {
            const userCounts: Record<string, { count: number; username: string }> = {};
            for (const log of heavyUsers as any[]) {
                const uid = log.user_id;
                if (!userCounts[uid]) {
                    userCounts[uid] = { count: 0, username: log.profiles?.username || uid };
                }
                userCounts[uid].count++;
            }

            for (const [userId, data] of Object.entries(userCounts)) {
                if (data.count > maxExecPerHour * 0.8) {
                    alerts.push({
                        userId,
                        username: data.username,
                        issue: 'Excessive executions',
                        severity: data.count > maxExecPerHour ? 'critical' : 'warning',
                        details: { executionsLastHour: data.count, limit: maxExecPerHour }
                    });
                }
            }
        }

        // Check for high failure rates (possible infinite loops)
        const { data: failedLogs } = await supabaseAdmin
            .from('execution_logs')
            .select('user_id, profiles(username), status')
            .gte('created_at', oneHourAgo)
            .in('status', ['timeout', 'error']);

        if (failedLogs) {
            const failCounts: Record<string, { count: number; username: string }> = {};
            for (const log of failedLogs as any[]) {
                const uid = log.user_id;
                if (!failCounts[uid]) {
                    failCounts[uid] = { count: 0, username: log.profiles?.username || uid };
                }
                failCounts[uid].count++;
            }

            for (const [userId, data] of Object.entries(failCounts)) {
                if (data.count > 20) {
                    alerts.push({
                        userId,
                        username: data.username,
                        issue: 'High failure rate (possible infinite loops)',
                        severity: data.count > 50 ? 'critical' : 'warning',
                        details: { failedExecutionsLastHour: data.count }
                    });
                }
            }
        }

        // Check containers for high resource usage
        try {
            const containerStats = await dockerMonitorService.getAllContainerStats();
            for (const stat of containerStats) {
                if (stat.cpuPercent > 90) {
                    alerts.push({
                        userId: 'system',
                        username: 'system',
                        issue: `Container ${stat.id} using excessive CPU`,
                        severity: 'critical',
                        details: { containerId: stat.id, cpuPercent: stat.cpuPercent, memoryMb: stat.memoryUsageMb }
                    });
                }
                if (stat.memoryPercent > 90) {
                    alerts.push({
                        userId: 'system',
                        username: 'system',
                        issue: `Container ${stat.id} using excessive memory`,
                        severity: 'critical',
                        details: { containerId: stat.id, memoryPercent: stat.memoryPercent, memoryMb: stat.memoryUsageMb }
                    });
                }
            }
        } catch (_e) {
            // Docker might not be available
        }

        return alerts;
    }

    /**
     * Auto-block a user for abuse
     */
    async blockUser(userId: string, reason: string, blockedBy: string): Promise<void> {
        await supabaseAdmin
            .from('profiles')
            .update({
                status: 'blocked',
                blocked_at: new Date().toISOString(),
                blocked_reason: reason
            })
            .eq('id', userId);

        await auditService.log({
            action: 'user.block',
            performedBy: blockedBy,
            targetType: 'user',
            targetId: userId,
            details: { reason },
            severity: 'warning'
        });
    }

    /**
     * Unblock a user
     */
    async unblockUser(userId: string, unblockedBy: string): Promise<void> {
        await supabaseAdmin
            .from('profiles')
            .update({
                status: 'active',
                blocked_at: null,
                blocked_reason: null
            })
            .eq('id', userId);

        await auditService.log({
            action: 'user.unblock',
            performedBy: unblockedBy,
            targetType: 'user',
            targetId: userId,
            severity: 'info'
        });
    }

    /**
     * Get system settings from DB
     */
    async getSettings(): Promise<Record<string, string>> {
        const { data } = await supabaseAdmin
            .from('system_settings')
            .select('key, value');

        const settings: Record<string, string> = {};
        if (data) {
            for (const row of data) {
                settings[row.key] = typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
            }
        }
        return settings;
    }

    /**
     * Update a system setting
     */
    async updateSetting(key: string, value: string, updatedBy: string): Promise<void> {
        const { error } = await supabaseAdmin
            .from('system_settings')
            .upsert({
                key,
                value: JSON.stringify(value),
                updated_by: updatedBy,
                updated_at: new Date().toISOString()
            });

        if (error) throw error;

        await auditService.log({
            action: 'settings.update',
            performedBy: updatedBy,
            targetType: 'setting',
            targetId: key,
            details: { newValue: value },
            severity: 'info'
        });
    }
}

export const abuseDetectionService = new AbuseDetectionService();
