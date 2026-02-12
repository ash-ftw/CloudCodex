import { supabaseAdmin } from '../config/supabase';

export interface AuditLogEntry {
    action: string;
    performedBy: string | null;
    targetType?: string;
    targetId?: string;
    details?: Record<string, unknown>;
    ipAddress?: string;
    severity?: 'info' | 'warning' | 'error' | 'critical';
}

export interface AuditLogFilter {
    action?: string;
    performedBy?: string;
    targetType?: string;
    severity?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
}

/**
 * Audit Log Service
 * Tracks all admin actions and system events for accountability
 */
export class AuditService {
    /**
     * Record an audit log entry
     */
    async log(entry: AuditLogEntry): Promise<void> {
        try {
            const { error } = await supabaseAdmin
                .from('audit_logs')
                .insert({
                    action: entry.action,
                    performed_by: entry.performedBy,
                    target_type: entry.targetType || null,
                    target_id: entry.targetId || null,
                    details: entry.details || {},
                    ip_address: entry.ipAddress || null,
                    severity: entry.severity || 'info'
                });

            if (error) {
                console.error('Audit log insert error:', error);
            }
        } catch (err) {
            console.error('Audit service error:', err);
        }
    }

    /**
     * Query audit logs with filters and pagination
     */
    async query(filter: AuditLogFilter) {
        const page = filter.page || 1;
        const limit = filter.limit || 50;
        const offset = (page - 1) * limit;

        let query = supabaseAdmin
            .from('audit_logs')
            .select('*, profiles:performed_by(username)', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (filter.action) {
            query = query.ilike('action', `%${filter.action}%`);
        }
        if (filter.performedBy) {
            query = query.eq('performed_by', filter.performedBy);
        }
        if (filter.targetType) {
            query = query.eq('target_type', filter.targetType);
        }
        if (filter.severity) {
            query = query.eq('severity', filter.severity);
        }
        if (filter.startDate) {
            query = query.gte('created_at', filter.startDate);
        }
        if (filter.endDate) {
            query = query.lte('created_at', filter.endDate);
        }

        const { data, error, count } = await query;

        if (error) throw error;

        return {
            data: data || [],
            pagination: {
                page,
                limit,
                total: count || 0,
                totalPages: Math.ceil((count || 0) / limit)
            }
        };
    }
}

export const auditService = new AuditService();
