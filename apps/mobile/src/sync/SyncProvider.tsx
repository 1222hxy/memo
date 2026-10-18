/**
 * 登录状态和同步状态。登录后启动同步引擎；拉取到其他设备的改动时 version + 1，
 * 页面据此重新读取本地数据。
 */
import type { Session } from '@supabase/supabase-js';
import { useSQLiteContext } from 'expo-sqlite';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { SyncEngine, type SyncStatus } from './engine';
import { supabase } from './supabase';

interface SyncContextValue {
  /** 是否配置了云端（.env 里有 Supabase 地址）。 */
  configured: boolean;
  session: Session | null;
  status: SyncStatus | null;
  /** 每次拉取到其他设备的改动就 + 1。 */
  version: number;
  syncNow: () => void;
  /** 成功返回 null，失败返回错误信息。 */
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [version, setVersion] = useState(0);
  const engine = useRef<SyncEngine | null>(null);

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    client.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = client.auth.onAuthStateChange((_event, s) => setSession(s));
    // 只在前台时自动刷新登录凭证。
    const sub = AppState.addEventListener('change', (state) =>
      state === 'active' ? client.auth.startAutoRefresh() : client.auth.stopAutoRefresh(),
    );
    return () => {
      data.subscription.unsubscribe();
      sub.remove();
    };
  }, []);

  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (!supabase || !userId) {
      setStatus(null);
      return;
    }
    const e = new SyncEngine(db, supabase, { onData: () => setVersion((v) => v + 1), onStatus: setStatus });
    engine.current = e;
    e.start();
    return () => {
      e.stop();
      engine.current = null;
    };
  }, [db, userId]);

  const value: SyncContextValue = {
    configured: supabase !== null,
    session,
    status,
    version,
    syncNow: () => engine.current?.sync(),
    signIn: async (email, password) => {
      if (!supabase) return '还没有配置云端';
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return error?.message ?? null;
    },
    signUp: async (email, password) => {
      if (!supabase) return '还没有配置云端';
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) return error.message;
      // 没有拿到登录状态，说明 Supabase 还开着邮箱确认。
      if (!data.session) {
        return '账号已创建，但 Supabase 要求邮箱确认。请在 Authentication → Sign In / Providers → Email 里关掉 Confirm email，再点登录。';
      }
      return null;
    },
    signOut: async () => {
      await supabase?.auth.signOut();
    },
  };

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync 必须在 SyncProvider 里使用');
  return ctx;
}
