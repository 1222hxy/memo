/**
 * 本地数据读写。复习记录和事件只插入、从不修改；删除卡片只做软删除。
 */
import {
  buildEvent,
  newId,
  newMemoryState,
  type Block,
  type Card,
  type DeviceKind,
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
    [id, DEFAULT_FOLDER_NAME, 'a0', now, now],
  );
  return id;
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
       learning_steps, scheduled_days, introduced_at, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
         learning_steps = ?, scheduled_days = ?, introduced_at = coalesce(introduced_at, ?)
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
