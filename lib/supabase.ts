// Server 端 Supabase client（單例）
// 用 service role key —— 只在 route handler（server）裡 import，絕不要在 'use client' 元件用。
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 未設置');
  }
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}
