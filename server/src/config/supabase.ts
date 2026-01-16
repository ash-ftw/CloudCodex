import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from './index';

// Lazy-initialized clients to ensure dotenv is loaded first
let _supabase: SupabaseClient | null = null;
let _supabaseAdmin: SupabaseClient | null = null;

// Public client for client-side operations
export function getSupabase(): SupabaseClient {
    if (!_supabase) {
        _supabase = createClient(
            config.supabase.url,
            config.supabase.anonKey
        );
    }
    return _supabase;
}

// Admin client for server-side operations requiring elevated permissions
export function getSupabaseAdmin(): SupabaseClient {
    if (!_supabaseAdmin) {
        _supabaseAdmin = createClient(
            config.supabase.url,
            config.supabase.serviceRoleKey,
            {
                auth: {
                    autoRefreshToken: false,
                    persistSession: false
                }
            }
        );
    }
    return _supabaseAdmin;
}

// Legacy exports for backward compatibility (getter properties)
export const supabase = new Proxy({} as SupabaseClient, {
    get(_target, prop) {
        return (getSupabase() as any)[prop];
    }
});

export const supabaseAdmin = new Proxy({} as SupabaseClient, {
    get(_target, prop) {
        return (getSupabaseAdmin() as any)[prop];
    }
});

