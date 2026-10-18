/**
 * 本地数据读写。复习记录和事件只插入、从不修改；删除卡片只做软删除。
 */
import {
  buildEvent,
  newId,
  newMemoryState,
  type Block,
  type Card,
  type CardPlacement,
  type DeviceKind,
  type Folder,
  type EventPayload,
  type MaskTarget,
  type Memory,
  type MemoryState,
  type Millis,
  type ReviewLogRecord,
} from '@memo/core';
import type { SQLiteDatabase } from 'expo-sqlite';

const DEFAULT_FOLDER_NAME = '收件箱';

/** 「一天」从凌晨 4 点开始，熬夜复习不会被算到第二天。 */
export function dayStart(now: Millis): Millis {
  const d = new Date(now - 4 * 3_600_000);
  d.setHours(4, 0, 0, 0);
  return d.getTime();
}

// ---------- 行 ↔ 模型 ----------

interface MemoryRow {
  id: string;
  card_id: string;
  masks: string;
  phase: MemoryState['phase'];
  difficulty: number;
  stability: number;
  due: number | null;
  last_review: number | null;
  reps: number;
  lapses: number;
  learning_steps: number;
  scheduled_days: number;
  introduced_at: number | null;
  created_at: number;
}

function toMemory(r: MemoryRow): Memory {
  return {
    id: r.id,
    cardId: r.card_id,
    masks: JSON.parse(r.masks) as MaskTarget[],
    state: {
      phase: r.phase,
      difficulty: r.difficulty,
      stability: r.stability,
      due: r.due,
      lastReview: r.last_review,
      reps: r.reps,
      lapses: r.lapses,
      learningSteps: r.learning_steps,
      scheduledDays: r.scheduled_days,
    },
    introducedAt: r.introduced_at,
    createdAt: r.created_at,
  };
}

interface BlockRow {
  id: string;
  card_id: string;
  type: Block['type'];
  content: string;
  sort_key: string;
  updated_at: number;
}

const toBlock = (r: BlockRow): Block => ({
  id: r.id,
  cardId: r.card_id,
  type: r.type,
  content: r.content,
  sortKey: r.sort_key,
  updatedAt: r.updated_at,
});

// ---------- 事件 ----------

export async function recordEvent(db: SQLiteDatabase, payload: EventPayload, device: DeviceKind): Promise<void> {
  const { type, ...rest } = payload;
  const e = buildEvent(payload, device, Date.now());
  await db.runAsync('insert into events (id, type, at, device, payload) values (?, ?, ?, ?, ?)', [
    e.id,
    type,
    e.at,
    e.device,
    JSON.stringify(rest),
  ]);
}

// ---------- 文件夹 ----------

interface FolderRow {
  id: string;
  parent_id: string | null;
  name: string;
  sort_key: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

const toFolder = (r: FolderRow): Folder => ({
  id: r.id,
  parentId: r.parent_id,
  name: r.name,
  sortKey: r.sort_key,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
});

/** 新建项排在最后：按创建时间生成、可按字符串比较的排序键。 */
const sortKeyNow = () => Date.now().toString(36).padStart(10, '0');

/** 还没有文件夹时，建一个默认的。 */
export async function ensureDefaultFolder(db: SQLiteDatabase): Promise<string> {
  const row = await db.getFirstAsync<{ id: string }>(
    'select id from folders where deleted_at is null order by created_at limit 1',
  );
  if (row) return row.id;
  const id = newId();
  const now = Date.now();
  await db.runAsync(
    'insert into folders (id, parent_id, name, sort_key, created_at, updated_at) values (?, null, ?, ?, ?, ?)',
    [id, DEFAULT_FOLDER_NAME, sortKeyNow(), now, now],
  );
  return id;
}

export async function loadFolders(db: SQLiteDatabase): Promise<Folder[]> {
  const rows = await db.getAllAsync<FolderRow>('select * from folders where deleted_at is null');
  return rows.map(toFolder);
}

export async function createFolder(
  db: SQLiteDatabase,
  parentId: string | null,
  name: string,
  device: DeviceKind,
): Promise<string> {
  const id = newId();
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'insert into folders (id, parent_id, name, sort_key, created_at, updated_at) values (?, ?, ?, ?, ?, ?)',
      [id, parentId, name, sortKeyNow(), now, now],
    );
    await recordEvent(db, { type: 'folder_created', folderId: id, parentId }, device);
  });
  return id;
}

export async function renameFolder(db: SQLiteDatabase, id: string, name: string, device: DeviceKind): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('update folders set name = ?, updated_at = ? where id = ?', [name, Date.now(), id]);
    await recordEvent(db, { type: 'folder_renamed', folderId: id }, device);
  });
}

export async function moveFolder(
  db: SQLiteDatabase,
  id: string,
  parentId: string | null,
  device: DeviceKind,
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('update folders set parent_id = ?, sort_key = ?, updated_at = ? where id = ?', [
      parentId,
      sortKeyNow(),
      Date.now(),
      id,
    ]);
    await recordEvent(db, { type: 'folder_moved', folderId: id, parentId }, device);
  });
}

/** 只能删除空文件夹（没有子文件夹、卡片和关联），避免误删内容。返回是否删除成功。 */
export async function deleteFolder(db: SQLiteDatabase, id: string, device: DeviceKind): Promise<boolean> {
  const row = await db.getFirstAsync<{ n: number }>(
    `select (select count(*) from folders where parent_id = ? and deleted_at is null)
          + (select count(*) from cards where folder_id = ? and deleted_at is null)
          + (select count(*) from card_links l join cards c on c.id = l.card_id
             where l.folder_id = ? and l.deleted_at is null and c.deleted_at is null) as n`,
    [id, id, id],
  );
  if ((row?.n ?? 0) > 0) return false;
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    await db.runAsync('update folders set deleted_at = ?, updated_at = ? where id = ?', [now, now, id]);
    await recordEvent(db, { type: 'folder_deleted', folderId: id }, device);
  });
  return true;
}

// ---------- 卡片的位置 ----------

/** 所有未删除卡片的主位置和关联位置。 */
export async function loadPlacements(db: SQLiteDatabase): Promise<CardPlacement[]> {
  const cards = await db.getAllAsync<{ id: string; folder_id: string }>(
    'select id, folder_id from cards where deleted_at is null',
  );
  const links = await db.getAllAsync<{ card_id: string; folder_id: string }>(
    'select card_id, folder_id from card_links where deleted_at is null',
  );
  const linked = new Map<string, string[]>();
  for (const l of links) linked.set(l.card_id, [...new Set([...(linked.get(l.card_id) ?? []), l.folder_id])]);
  return cards.map((c) => ({ cardId: c.id, folderId: c.folder_id, linkedFolderIds: linked.get(c.id) ?? [] }));
}

export async function loadPlacement(db: SQLiteDatabase, cardId: string): Promise<CardPlacement | null> {
  const card = await db.getFirstAsync<{ folder_id: string }>('select folder_id from cards where id = ?', [cardId]);
  if (!card) return null;
  const links = await db.getAllAsync<{ folder_id: string }>('select distinct folder_id from card_links where card_id = ? and deleted_at is null', [
    cardId,
  ]);
  return { cardId, folderId: card.folder_id, linkedFolderIds: links.map((l) => l.folder_id) };
}

/** 设置卡片的主位置和关联位置（关联里会自动去掉主位置）。 */
export async function setPlacement(
  db: SQLiteDatabase,
  cardId: string,
  folderId: string,
  linkedFolderIds: readonly string[],
  device: DeviceKind,
): Promise<void> {
  const links = [...new Set(linkedFolderIds)].filter((f) => f !== folderId);
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    await db.runAsync('update cards set folder_id = ?, updated_at = ? where id = ?', [folderId, now, cardId]);
    // 关联只做软删除，删除才能同步到其他设备。
    const existing = await db.getAllAsync<{ id: string; folder_id: string; deleted_at: number | null }>(
      'select id, folder_id, deleted_at from card_links where card_id = ?',
      [cardId],
    );
    for (const l of existing) {
      const keep = links.includes(l.folder_id);
      if (keep && l.deleted_at !== null) {
        await db.runAsync('update card_links set deleted_at = null, updated_at = ? where id = ?', [now, l.id]);
      } else if (!keep && l.deleted_at === null) {
        await db.runAsync('update card_links set deleted_at = ?, updated_at = ? where id = ?', [now, now, l.id]);
      }
    }
    for (const f of links) {
      if (existing.some((l) => l.folder_id === f)) continue;
      await db.runAsync(
        'insert into card_links (id, card_id, folder_id, created_at, updated_at) values (?, ?, ?, ?, ?)',
        [newId(), cardId, f, now, now],
      );
    }
    await recordEvent(db, { type: 'card_placed', cardId, folderId, linkedFolderIds: links }, device);
  });
}

export interface CardSummary {
  cardId: string;
  /** 第一块内容的开头，用来在列表里认出这张卡。 */
  preview: string;
  /** true = 关联进来的，不是主位置。 */
  linked: boolean;
}

/** 某个文件夹里直接放着的卡片（不含子文件夹），包括关联进来的。 */
export async function listFolderCards(db: SQLiteDatabase, folderId: string): Promise<CardSummary[]> {
  const rows = await db.getAllAsync<{ id: string; linked: number; preview: string | null }>(
    `select c.id, case when c.folder_id = ? then 0 else 1 end as linked,
            (select content from blocks b where b.card_id = c.id order by sort_key limit 1) as preview
     from cards c
     where c.deleted_at is null
       and (c.folder_id = ? or exists (select 1 from card_links l where l.card_id = c.id and l.folder_id = ? and l.deleted_at is null))
     order by c.created_at desc`,
    [folderId, folderId, folderId],
  );
  return rows.map((r) => ({ cardId: r.id, preview: (r.preview ?? '').split('\n')[0]!, linked: r.linked === 1 }));
}

// ---------- 卡片 ----------

/** 目前的简单卡：第一块是题目，第二块是答案，答案整块被遮住，构成一个记忆。 */
export interface SimpleCardInput {
  front: string;
  back: string;
}

export interface CardContent {
  card: Card;
  blocks: Block[];
}

export async function createSimpleCard(
  db: SQLiteDatabase,
  folderId: string,
  input: SimpleCardInput,
  device: DeviceKind,
): Promise<Memory> {
  const now = Date.now();
  const cardId = newId();
  const frontId = newId();
  const backId = newId();
  const memory: Memory = {
    id: newId(),
    cardId,
    masks: [{ kind: 'block', blockId: backId }],
    state: newMemoryState(),
    introducedAt: null,
    createdAt: now,
  };
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'insert into cards (id, folder_id, version, suspended, created_at, updated_at) values (?, ?, 1, 0, ?, ?)',
      [cardId, folderId, now, now],
    );
    await db.runAsync(
      `insert into blocks (id, card_id, type, content, sort_key, updated_at) values
       (?, ?, 'text', ?, 'a0', ?), (?, ?, 'text', ?, 'a1', ?)`,
      [frontId, cardId, input.front, now, backId, cardId, input.back, now],
    );
    await insertMemory(db, memory);
    await recordEvent(db, { type: 'card_created', cardId }, device);
    await recordEvent(db, { type: 'memory_added', memoryId: memory.id, cardId }, device);
  });
  return memory;
}

export async function updateSimpleCard(
  db: SQLiteDatabase,
  cardId: string,
  input: SimpleCardInput,
  device: DeviceKind,
): Promise<void> {
  const now = Date.now();
  const blocks = await db.getAllAsync<{ id: string }>(
    'select id from blocks where card_id = ? order by sort_key',
    [cardId],
  );
  const [front, back] = blocks;
  if (!front || !back) return;
  await db.withTransactionAsync(async () => {
    await db.runAsync('update blocks set content = ?, updated_at = ? where id = ?', [input.front, now, front.id]);
    await db.runAsync('update blocks set content = ?, updated_at = ? where id = ?', [input.back, now, back.id]);
    await db.runAsync('update cards set version = version + 1, updated_at = ? where id = ?', [now, cardId]);
    const row = await db.getFirstAsync<{ version: number }>('select version from cards where id = ?', [cardId]);
    await recordEvent(db, { type: 'card_edited', cardId, version: row?.version ?? 0 }, device);
  });
}

export async function deleteCard(db: SQLiteDatabase, cardId: string, device: DeviceKind): Promise<void> {
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    await db.runAsync('update cards set deleted_at = ?, updated_at = ? where id = ?', [now, now, cardId]);
    await recordEvent(db, { type: 'card_deleted', cardId }, device);
  });
}

export async function loadCard(db: SQLiteDatabase, cardId: string): Promise<CardContent | null> {
  const c = await db.getFirstAsync<{
    id: string;
    folder_id: string;
    version: number;
    suspended: number;
    created_at: number;
    updated_at: number;
    deleted_at: number | null;
  }>('select * from cards where id = ?', [cardId]);
  if (!c) return null;
  const blocks = await db.getAllAsync<BlockRow>('select * from blocks where card_id = ? order by sort_key', [cardId]);
  return {
    card: {
      id: c.id,
      folderId: c.folder_id,
      version: c.version,
      suspended: c.suspended === 1,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      deletedAt: c.deleted_at,
    },
    blocks: blocks.map(toBlock),
  };
}

// ---------- 记忆与复习 ----------

async function insertMemory(db: SQLiteDatabase, m: Memory): Promise<void> {
  const s = m.state;
  await db.runAsync(
    `insert into memories (id, card_id, masks, phase, difficulty, stability, due, last_review, reps, lapses,
       learning_steps, scheduled_days, introduced_at, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      m.id,
      m.cardId,
      JSON.stringify(m.masks),
      s.phase,
      s.difficulty,
      s.stability,
      s.due,
      s.lastReview,
      s.reps,
      s.lapses,
      s.learningSteps,
      s.scheduledDays,
      m.introducedAt,
      m.createdAt,
      m.createdAt,
    ],
  );
}

/** 所有可以参与复习的记忆（卡片未删除、未暂停）。 */
export async function loadMemories(db: SQLiteDatabase): Promise<Memory[]> {
  const rows = await db.getAllAsync<MemoryRow>(
    `select m.* from memories m join cards c on c.id = m.card_id
     where c.deleted_at is null and c.suspended = 0`,
  );
  return rows.map(toMemory);
}

/** 写入一次复习：更新记忆状态，并追加一条复习记录。 */
export async function recordReview(db: SQLiteDatabase, log: ReviewLogRecord, introducedAt: Millis): Promise<void> {
  const s = log.stateAfter;
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `update memories set phase = ?, difficulty = ?, stability = ?, due = ?, last_review = ?, reps = ?, lapses = ?,
         learning_steps = ?, scheduled_days = ?, introduced_at = coalesce(introduced_at, ?),
         updated_at = ?
       where id = ?`,
      [
        s.phase,
        s.difficulty,
        s.stability,
        s.due,
        s.lastReview,
        s.reps,
        s.lapses,
        s.learningSteps,
        s.scheduledDays,
        introducedAt,
        log.reviewedAt,
        log.memoryId,
      ],
    );
    await db.runAsync(
      `insert into review_logs (id, memory_id, card_id, card_version, reviewed_at, timezone, device, grade,
         slider_mode, slider_value, slider_trace, think_ms, rate_ms, state_before, state_after,
         retrievability_before, elapsed_days, scheduled_days, algorithm_version, weights_version, mode,
         scope_folder_id, pick_kind, entry, offline)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        log.id,
        log.memoryId,
        log.cardId,
        log.cardVersion,
        log.reviewedAt,
        log.timezone,
        log.device,
        log.grade,
        log.sliderMode,
        log.sliderValue,
        JSON.stringify(log.sliderTrace),
        log.thinkMs,
        log.rateMs,
        JSON.stringify(log.stateBefore),
        JSON.stringify(log.stateAfter),
        log.retrievabilityBefore,
        log.elapsedDays,
        log.scheduledDays,
        log.algorithmVersion,
        log.weightsVersion,
        log.mode,
        log.scopeFolderId,
        log.pickKind,
        log.entry,
        log.offline ? 1 : 0,
      ],
    );
  });
}

/** 选题需要的「最近情况」，全部从数据库推出来，App 重开后也连续。 */
export interface SessionState {
  recentCardIds: string[];
  newIntroducedToday: number;
  picksSinceNew: number;
}

export async function loadSession(db: SQLiteDatabase, now: Millis): Promise<SessionState> {
  const recent = await db.getAllAsync<{ card_id: string; pick_kind: string }>(
    'select card_id, pick_kind from review_logs order by reviewed_at desc limit 50',
  );
  const sinceNew = recent.findIndex((r) => r.pick_kind === 'new');
  const introduced = await db.getFirstAsync<{ n: number }>(
    'select count(*) as n from memories where introduced_at >= ?',
    [dayStart(now)],
  );
  return {
    recentCardIds: recent.slice(0, 10).map((r) => r.card_id),
    newIntroducedToday: introduced?.n ?? 0,
    picksSinceNew: sinceNew === -1 ? recent.length : sinceNew,
  };
}

// ---------- 设置（每台设备各自的） ----------

export async function getSetting<T>(db: SQLiteDatabase, key: string, fallback: T): Promise<T> {
  const row = await db.getFirstAsync<{ value: string }>('select value from settings where key = ?', [key]);
  return row ? (JSON.parse(row.value) as T) : fallback;
}

export async function setSetting(db: SQLiteDatabase, key: string, value: unknown, device: DeviceKind): Promise<void> {
  await db.runAsync('insert or replace into settings (key, value) values (?, ?)', [key, JSON.stringify(value)]);
  await recordEvent(db, { type: 'settings_changed', key, value }, device);
}
