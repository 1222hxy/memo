/**
 * 同步引擎：先拉取、再上传。
 *
 * 拉取：每张表按服务器时间 server_updated_at 增量取回（往回多取一分钟，防止漏掉提交较晚的行）。
 *   可修改的表「后写的赢」：云端的 updated_at 比本地新才覆盖，并从待上传队列里去掉这一行。
 *   只增不改的表：本地没有才插入。
 * 上传：读待上传队列（由本地触发器自动记录），按表顺序 upsert 到云端，成功后出队。
 *   云端触发器同样「后写的赢」，被拒绝的旧版本会在下次拉取时被云端的新版本覆盖。
 * 何时同步：登录后、回到前台、有待上传的改动（每几秒检查一次）、其他设备有改动（Realtime 通知）、
 *   以及每分钟一次兜底。
 */
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { SQLiteDatabase } from 'expo-sqlite';
import { AppState, type NativeEventSubscription } from 'react-native';

import { TABLES, toLocal, toRemote, type TableSpec } from './tables';

const PAGE = 500;
const OVERLAP_MS = 60_000;
const CHECK_PENDING_MS = 4_000;
const FALLBACK_MS = 60_000;

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'error';
  lastSyncedAt: number | null;
  error: string | null;
  pending: number;
}

interface Callbacks {
  /** 拉取到了其他设备的改动。 */
  onData: () => void;
  onStatus: (s: SyncStatus) => void;
}

type Row = Record<string, unknown>;

/** Postgres 的时间带微秒，Hermes 不一定能解析，先截到毫秒。 */
const parseTime = (iso: string) => Date.parse(iso.replace(/(\.\d{3})\d+/, '$1'));

export class SyncEngine {
  private running = false;
  private again = false;
  private timers: ReturnType<typeof setInterval>[] = [];
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private channel: RealtimeChannel | null = null;
  private appState: NativeEventSubscription | null = null;
  private status: SyncStatus = { state: 'idle', lastSyncedAt: null, error: null, pending: 0 };

  constructor(
    private db: SQLiteDatabase,
    private client: SupabaseClient,
    private cb: Callbacks,
  ) {}

  start(): void {
    this.sync();
    this.timers.push(
      setInterval(async () => {
        if (AppState.currentState === 'active' && (await this.pendingCount()) > 0) this.sync();
      }, CHECK_PENDING_MS),
      setInterval(() => AppState.currentState === 'active' && this.sync(), FALLBACK_MS),
    );
    this.appState = AppState.addEventListener('change', (s) => s === 'active' && this.sync());
    this.channel = this.client
      .channel('memo-sync')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => this.soon())
      .subscribe();
  }

  stop(): void {
    this.timers.forEach(clearInterval);
    this.timers = [];
    if (this.debounce) clearTimeout(this.debounce);
    this.appState?.remove();
    if (this.channel) this.client.removeChannel(this.channel);
    this.channel = null;
  }

  /** 其他设备的改动往往一次来很多条，合并成一次同步。 */
  private soon(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.sync(), 800);
  }

  async sync(): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    this.setStatus({ state: 'syncing' });
    try {
      const changed = await this.pull();
      await this.push();
      this.setStatus({ state: 'idle', lastSyncedAt: Date.now(), error: null, pending: await this.pendingCount() });
      if (changed) this.cb.onData();
    } catch (e) {
      this.setStatus({
        state: 'error',
        error: e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e),
        pending: await this.pendingCount(),
      });
    } finally {
      this.running = false;
      if (this.again) {
        this.again = false;
        this.sync();
      }
    }
  }

  private setStatus(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch };
    this.cb.onStatus(this.status);
  }

  private async pendingCount(): Promise<number> {
    const row = await this.db.getFirstAsync<{ n: number }>('select count(*) as n from sync_outbox');
    return row?.n ?? 0;
  }

  private async getState(key: string): Promise<string | null> {
    const row = await this.db.getFirstAsync<{ value: string }>('select value from sync_state where key = ?', [key]);
    return row?.value ?? null;
  }

  private async setState(key: string, value: string): Promise<void> {
    await this.db.runAsync('insert or replace into sync_state (key, value) values (?, ?)', [key, value]);
  }

  // ---------- 拉取 ----------

  private async pull(): Promise<boolean> {
    let changed = false;
    for (const spec of TABLES) {
      const key = `cursor.${spec.name}`;
      const cursor = await this.getState(key);
      let since = cursor ? new Date(parseTime(cursor) - OVERLAP_MS).toISOString() : new Date(0).toISOString();
      let newest = cursor;
      for (;;) {
        const { data, error } = await this.client
          .from(spec.name)
          .select('*')
          .gt('server_updated_at', since)
          .order('server_updated_at')
          .order('id')
          .limit(PAGE);
        if (error) throw error;
        const rows = (data ?? []) as Row[];
        if (await this.apply(spec, rows)) changed = true;
        const last = rows[rows.length - 1];
        if (last) {
          since = String(last.server_updated_at);
          if (!newest || parseTime(since) > parseTime(newest)) newest = since;
        }
        if (rows.length < PAGE) break;
      }
      if (newest && newest !== cursor) await this.setState(key, newest);
    }
    return changed;
  }

  /**
   * 写入拉取到的行。用独立连接的独占事务：其中把 applying 置 1，触发器就不会把这些行放进待上传队列；
   * 别的连接看不到这个未提交的标记，用户同时做的修改照常入队。
   */
  private async apply(spec: TableSpec, rows: Row[]): Promise<boolean> {
    if (rows.length === 0) return false;
    let changed = false;
    const cols = spec.columns.join(', ');
    const marks = spec.columns.map(() => '?').join(', ');
    await this.db.withExclusiveTransactionAsync(async (txn) => {
      await txn.runAsync('update sync_flags set applying = 1');
      for (const r of rows) {
        if (spec.appendOnly) {
          const res = await txn.runAsync(`insert or ignore into ${spec.name} (${cols}) values (${marks})`, toLocal(spec, r) as never[]);
          if (res.changes > 0) changed = true;
          continue;
        }
        const local = await txn.getFirstAsync<{ updated_at: number }>(`select updated_at from ${spec.name} where id = ?`, [
          String(r.id),
        ]);
        if (local && Number(r.updated_at) <= local.updated_at) continue;
        await txn.runAsync(`insert or replace into ${spec.name} (${cols}) values (${marks})`, toLocal(spec, r) as never[]);
        await txn.runAsync('delete from sync_outbox where tbl = ? and row_id = ?', [spec.name, String(r.id)]);
        changed = true;
      }
      await txn.runAsync('update sync_flags set applying = 0');
    });
    return changed;
  }

  // ---------- 上传 ----------

  private async push(): Promise<void> {
    for (;;) {
      const batch = await this.db.getAllAsync<{ seq: number; tbl: string; row_id: string }>(
        'select seq, tbl, row_id from sync_outbox order by seq limit ?',
        [PAGE],
      );
      if (batch.length === 0) return;
      for (const spec of TABLES) {
        const items = batch.filter((b) => b.tbl === spec.name);
        if (items.length === 0) continue;
        const ids = [...new Set(items.map((i) => i.row_id))];
        const marks = ids.map(() => '?').join(', ');
        const rows = await this.db.getAllAsync<Row>(`select * from ${spec.name} where id in (${marks})`, ids);
        if (rows.length > 0) {
          const payload = rows.map((r) => toRemote(spec, r));
          const { error } = await this.client
            .from(spec.name)
            .upsert(payload, spec.appendOnly ? { onConflict: 'id', ignoreDuplicates: true } : { onConflict: 'id' });
          if (error) throw error;
        }
        // 只出队这一批里看到的记录；上传期间又改过的行有更大的 seq，会留到下一轮。
        const maxSeq = Math.max(...items.map((i) => i.seq));
        await this.db.runAsync(`delete from sync_outbox where tbl = ? and seq <= ? and row_id in (${marks})`, [
          spec.name,
          maxSeq,
          ...ids,
        ]);
      }
    }
  }
}
