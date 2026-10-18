/**
 * Supabase 客户端。地址和 publishable key 来自 apps/mobile/.env（不提交）：
 *   EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
 *   EXPO_PUBLIC_SUPABASE_KEY=sb_publishable_...
 * 没配置时为 null，App 只在本机使用。
 */
import 'react-native-url-polyfill/auto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Storage from 'expo-sqlite/kv-store';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY;

export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: { storage: Storage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
      })
    : null;
