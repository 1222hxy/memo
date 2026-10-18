/**
 * 每张同步表的列，以及本地（SQLite）和云端（Postgres）之间的格式转换：
 * 本地 JSON 存成文本、布尔存成 0 / 1；云端是 jsonb 和 boolean。
 */
import type { SyncedTable } from '../db/schema';

export interface TableSpec {
  name: SyncedTable;
  columns: string[];
  json?: string[];
  bool?: string[];
  /** 只增不改的表：上传时重复的忽略，拉取时已有的跳过。 */
  appendOnly?: boolean;
}

export const TABLES: TableSpec[] = [
  { name: 'folders', columns: ['id', 'parent_id', 'name', 'sort_key', 'created_at', 'updated_at', 'deleted_at'] },
  {
    name: 'cards',
    columns: ['id', 'folder_id', 'version', 'suspended', 'created_at', 'updated_at', 'deleted_at'],
    bool: ['suspended'],
  },
  { name: 'card_links', columns: ['id', 'card_id', 'folder_id', 'created_at', 'updated_at', 'deleted_at'] },
  { name: 'blocks', columns: ['id', 'card_id', 'type', 'content', 'sort_key', 'updated_at'] },
  {
    name: 'memories',
    columns: [
      'id',
      'card_id',
      'masks',
      'phase',
      'difficulty',
      'stability',
      'due',
      'last_review',
      'reps',
      'lapses',
      'learning_steps',
      'scheduled_days',
      'introduced_at',
      'created_at',
      'updated_at',
    ],
    json: ['masks'],
  },
  {
    name: 'review_logs',
    columns: [
      'id',
      'memory_id',
      'card_id',
      'card_version',
      'reviewed_at',
      'timezone',
      'device',
      'grade',
      'slider_mode',
      'slider_value',
      'slider_trace',
      'think_ms',
      'rate_ms',
      'state_before',
      'state_after',
      'retrievability_before',
      'elapsed_days',
      'scheduled_days',
      'algorithm_version',
      'weights_version',
      'mode',
      'scope_folder_id',
      'pick_kind',
      'entry',
      'offline',
    ],
    json: ['slider_trace', 'state_before', 'state_after'],
    bool: ['offline'],
    appendOnly: true,
  },
  { name: 'events', columns: ['id', 'type', 'at', 'device', 'payload'], json: ['payload'], appendOnly: true },
];

type Row = Record<string, unknown>;

export function toRemote(spec: TableSpec, row: Row): Row {
  const out: Row = {};
  for (const col of spec.columns) {
    const v = row[col];
    if (spec.json?.includes(col)) out[col] = typeof v === 'string' ? JSON.parse(v) : v;
    else if (spec.bool?.includes(col)) out[col] = v === 1 || v === true;
    else out[col] = v;
  }
  return out;
}

export function toLocal(spec: TableSpec, row: Row): unknown[] {
  return spec.columns.map((col) => {
    const v = row[col];
    if (v === undefined || v === null) return null;
    if (spec.json?.includes(col)) return typeof v === 'string' ? v : JSON.stringify(v);
    if (spec.bool?.includes(col)) return v ? 1 : 0;
    return v;
  });
}
