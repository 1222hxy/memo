/**
 * 手机本地的 SQLite 表结构，列名与 supabase/migrations 一一对应（去掉 user_id），
 * 以后接入 PowerSync 时可以直接映射。JSON 列存为 text，布尔存为 0 / 1。
 */
import type { SQLiteDatabase } from 'expo-sqlite';

/** 需要同步到云端的表，顺序即上传顺序。settings、sync_* 只在本机。 */
export const SYNCED_TABLES = ['folders', 'cards', 'card_links', 'blocks', 'memories', 'review_logs', 'events'] as const;
export type SyncedTable = (typeof SYNCED_TABLES)[number];

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

  // 2：准备同步。
  // - card_links 改为软删除，并去掉 (card_id, folder_id) 唯一约束（两台设备离线时可能各建一条）。
  // - memories 加 updated_at，用于「后写的赢」。
  // - sync_outbox 记录待上传的行，由触发器自动写入；应用拉取到的数据时把 sync_flags.applying 置 1 跳过。
  // - 现有的数据全部放进待上传队列。
  `
  create table card_links_new (
    id text primary key not null,
    card_id text not null,
    folder_id text not null,
    created_at integer not null,
    updated_at integer not null,
    deleted_at integer
  );
  insert into card_links_new (id, card_id, folder_id, created_at, updated_at)
    select id, card_id, folder_id, created_at, created_at from card_links;
  drop table card_links;
  alter table card_links_new rename to card_links;
  create index card_links_card on card_links (card_id);
  create index card_links_folder on card_links (folder_id);

  alter table memories add column updated_at integer not null default 0;
  update memories set updated_at = coalesce(last_review, created_at);

  create table sync_outbox (
    seq integer primary key autoincrement,
    tbl text not null,
    row_id text not null
  );
  create table sync_state (
    key text primary key not null,
    value text not null
  );
  create table sync_flags (applying integer not null);
  insert into sync_flags (applying) values (0);
  ${SYNCED_TABLES.map(
    (t) => `
  create trigger ${t}_outbox_insert after insert on ${t}
    when (select applying from sync_flags) = 0
    begin insert into sync_outbox (tbl, row_id) values ('${t}', new.id); end;
  create trigger ${t}_outbox_update after update on ${t}
    when (select applying from sync_flags) = 0
    begin insert into sync_outbox (tbl, row_id) values ('${t}', new.id); end;
  insert into sync_outbox (tbl, row_id) select '${t}', id from ${t};`,
  ).join('\n')}
  `,
];

/** 按 PRAGMA user_version 逐个执行还没跑过的迁移。 */
export async function migrate(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('pragma journal_mode = wal;');
  // 同步写入用独立连接，主连接遇到锁时等一会儿而不是直接报错。
  await db.execAsync('pragma busy_timeout = 5000;');
  const row = await db.getFirstAsync<{ user_version: number }>('pragma user_version');
  const current = row?.user_version ?? 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(MIGRATIONS[v]!);
      await db.execAsync(`pragma user_version = ${v + 1}`);
    });
  }
}
