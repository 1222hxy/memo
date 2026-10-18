/**
 * 复习记录与交互事件。全部只增不改：写入后不再修改，卡片删除也不删除它们。
 * 字段与设计文档「交互与记忆数据记录」一节一一对应。
 */

import { newId } from './ids';
import type { DeviceKind, Id, MemoryState, Millis } from './model';
import type { ReviewMode } from './modes';
import type { SliderResult } from './rating';
import type { ReviewOutcome, Scheduler } from './scheduler';
import type { PickKind } from './selection';

export type ReviewEntry = 'app' | 'lock-screen' | 'walkman';

/** 拖动轨迹上的一个点：相对题目揭示后的毫秒数，以及滑块位置。 */
export interface SliderPoint {
  t: number;
  v: number;
}

export interface ReviewLogRecord {
  id: Id;
  memoryId: Id;
  cardId: Id;
  cardVersion: number;

  reviewedAt: Millis;
  timezone: string;
  device: DeviceKind;

  grade: SliderResult['grade'];
  sliderMode: SliderResult['mode'];
  sliderValue: number;
  sliderTrace: SliderPoint[];

  /** 题目出现 → 揭示答案。 */
  thinkMs: number;
  /** 揭示答案 → 松手评分。 */
  rateMs: number;

  stateBefore: MemoryState;
  stateAfter: MemoryState;
  retrievabilityBefore: number | null;
  elapsedDays: number | null;
  scheduledDays: number;
  algorithmVersion: string;
  weightsVersion: string;

  mode: ReviewMode;
  /** 当前复习范围：null 表示「全部」，否则为文件夹 ID。 */
  scopeFolderId: Id | null;
  pickKind: PickKind | 'ahead';
  entry: ReviewEntry;
  offline: boolean;
}

export interface ReviewContext {
  memoryId: Id;
  cardId: Id;
  cardVersion: number;
  device: DeviceKind;
  timezone: string;
  scopeFolderId: Id | null;
  pickKind: ReviewLogRecord['pickKind'];
  entry: ReviewEntry;
  offline: boolean;
  /** 题目出现的时间。 */
  shownAt: Millis;
  /** 揭示答案的时间。 */
  revealedAt: Millis;
  /** 松手评分的时间。 */
  ratedAt: Millis;
  slider: SliderResult;
  sliderTrace: SliderPoint[];
}

export function buildReviewLog(ctx: ReviewContext, outcome: ReviewOutcome, scheduler: Scheduler): ReviewLogRecord {
  return {
    id: newId(),
    memoryId: ctx.memoryId,
    cardId: ctx.cardId,
    cardVersion: ctx.cardVersion,
    reviewedAt: ctx.ratedAt,
    timezone: ctx.timezone,
    device: ctx.device,
    grade: ctx.slider.grade,
    sliderMode: ctx.slider.mode,
    sliderValue: ctx.slider.value,
    sliderTrace: ctx.sliderTrace,
    thinkMs: Math.max(0, ctx.revealedAt - ctx.shownAt),
    rateMs: Math.max(0, ctx.ratedAt - ctx.revealedAt),
    stateBefore: outcome.before,
    stateAfter: outcome.after,
    retrievabilityBefore: outcome.retrievabilityBefore,
    elapsedDays: outcome.elapsedDays,
    scheduledDays: outcome.scheduledDays,
    algorithmVersion: scheduler.algorithmVersion,
    weightsVersion: scheduler.weightsVersion,
    mode: scheduler.mode,
    scopeFolderId: ctx.scopeFolderId,
    pickKind: ctx.pickKind,
    entry: ctx.entry,
    offline: ctx.offline,
  };
}

/** 复习以外的交互事件。 */
export type EventPayload =
  | { type: 'app_open' }
  | { type: 'app_close' }
  | { type: 'segment_start' }
  | { type: 'segment_end'; reviewed: number }
  | { type: 'pause_choice'; choice: 'stop' | 'continue' }
  | { type: 'review_undo'; reviewLogId: Id; restoredState: MemoryState }
  | { type: 'leech_prompt'; memoryId: Id; action: 'shown' | 'edited' | 'split' | 'ignored' }
  | { type: 'card_created'; cardId: Id }
  | { type: 'card_edited'; cardId: Id; version: number }
  | { type: 'card_deleted'; cardId: Id }
  | { type: 'memory_added'; memoryId: Id; cardId: Id }
  | { type: 'memory_removed'; memoryId: Id; cardId: Id }
  | { type: 'settings_changed'; key: string; value: unknown }
  | { type: 'folder_created'; folderId: Id; parentId: Id | null }
  | { type: 'folder_renamed'; folderId: Id }
  | { type: 'folder_moved'; folderId: Id; parentId: Id | null }
  | { type: 'folder_deleted'; folderId: Id }
  | { type: 'card_placed'; cardId: Id; folderId: Id; linkedFolderIds: Id[] }
  | { type: 'scope_changed'; folderId: Id | null };

export type MemoEvent = EventPayload & {
  id: Id;
  at: Millis;
  device: DeviceKind;
};

export function buildEvent(payload: EventPayload, device: DeviceKind, at: Millis): MemoEvent {
  return { ...payload, id: newId(), at, device };
}
