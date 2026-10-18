/**
 * 手机本地的 SQLite 表结构，列名与 supabase/migrations 一一对应（去掉 user_id），
 * 以后接入 PowerSync 时可以直接映射。JSON 列存为 text，布尔存为 0 / 1。
 */
import type { SQLiteDatabase } from 'expo-sqlite';

const MIGRATIONS: string[] = [
  `
  create table folders (
    id text primary key not null,
    parent_id text,
    name text not null,
    sort_key text not null,
    created_at integer not null,
    updated_at integer not null,
    deleted_at integer
  );

  create table cards (
    id text primary key not null,
    folder_id text not null,
    version integer not null default 1,
    suspended integer not null default 0,
    created_at integer not null,
    updated_at integer not null,
    deleted_at integer
  );

  create table card_links (
    id text primary key not null,
    card_id text not null,
    folder_id text not null,
    created_at integer not null,
    unique (card_id, folder_id)
  );

  create table blocks (
    id text primary key not null,
    card_id text not null,
    type text not null,
    content text not null,
    sort_key text not null,
    updated_at integer not null
  );

  create table memories (
    id text primary key not null,
    card_id text not null,
    masks text not null default '[]',
    phase text not null default 'new',
    difficulty real not null default 0,
    stability real not null default 0,
    due integer,
    last_review integer,
    reps integer not null default 0,
    lapses integer not null default 0,
    learning_steps integer not null default 0,
    scheduled_days integer not null default 0,
    introduced_at integer,
    created_at integer not null
  );

  create table review_logs (
    id text primary key not null,
    memory_id text not null,
    card_id text not null,
    card_version integer not null,
    reviewed_at integer not null,
    timezone text not null,
    device text not null,
    grade integer not null,
    slider_mode text not null,
    slider_value real not null,
    slider_trace text not null default '[]',
    think_ms integer not null,
    rate_ms integer not null,
    state_before text not null,
    state_after text not null,
    retrievability_before real,
    elapsed_days real,
    scheduled_days integer not null,
    algorithm_version text not null,
    weights_version text not null,
    mode text not null,
    scope_folder_id text,
    pick_kind text not null,
    entry text not null,
    offline integer not null
  );

  create table events (
    id text primary key not null,
    type text not null,
    at integer not null,
    device text not null,
    payload text not null default '{}'
  );

  create table settings (
    key text primary key not null,
    value text not null
  );

  create index folders_parent on folders (parent_id);
  create index cards_folder on cards (folder_id);
  create index blocks_card on blocks (card_id);
  create index memories_card on memories (card_id);
  create index review_logs_memory on review_logs (memory_id, reviewed_at);
  create index review_logs_time on review_logs (reviewed_at);
  create index events_time on events (at);
  `,
];

/** 按 PRAGMA user_version 逐个执行还没跑过的迁移。 */
export async function migrate(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('pragma journal_mode = wal;');
  const row = await db.getFirstAsync<{ user_version: number }>('pragma user_version');
  const current = row?.user_version ?? 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(MIGRATIONS[v]!);
      await db.execAsync(`pragma user_version = ${v + 1}`);
    });
  }
}
