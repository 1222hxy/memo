/**
 * 选题：回答「此刻最值得回忆的是哪一题？」
 *
 * 没有「到期队列」和「积压数」。每次只挑一题，规则按优先级：
 * 1. 短期学习步骤已到时间的（刚学或刚忘记的，需要很快再问一次）。
 * 2. 可提取性已低于目标的，优先挑可提取性「最高」的那个：
 *    它最接近被忘记但还没忘，此刻复习最能保住记忆；已经大概率忘掉的晚一点也差不多。
 * 3. 新记忆按每日额度渐进混入；有待复习的内容时，每隔几题才插入一个新的。
 * 同一张卡的不同遮盖不会连续出现，避免互相提示答案。
 */

import type { Id, Millis, Memory } from './model';
import { MODES } from './modes';
import type { Scheduler } from './scheduler';

export type PickKind = 'learning' | 'review' | 'new';

export interface Pick {
  memoryId: Id;
  kind: PickKind;
}

export interface SelectionContext {
  now: Millis;
  scheduler: Scheduler;
  /** 最近复习过的卡片 ID（新的在前），用于同卡间隔。 */
  recentCardIds: readonly Id[];
  /** 今天已经引入的新记忆数。 */
  newIntroducedToday: number;
  /** 距上一次引入新记忆已经复习了几题。 */
  picksSinceNew: number;
}

/** 同一张卡至少间隔这么多题才会再次出现。 */
export const SIBLING_GAP = 3;
/** 有待复习内容时，每复习这么多题才插入一个新记忆。 */
export const NEW_INTERLEAVE = 4;
/** 待复习数达到这个值时，暂停引入新记忆。 */
export const BACKLOG_LIMIT = 50;

/** 根据当前积压情况，今天还能引入多少新记忆。 */
export function newBudget(ctx: SelectionContext, dueCount: number): number {
  const base = MODES[ctx.scheduler.mode].newPerDay;
  const scaled = Math.floor(base * Math.max(0, 1 - dueCount / BACKLOG_LIMIT));
  return Math.max(0, scaled - ctx.newIntroducedToday);
}

interface Scored {
  memory: Memory;
  r: number | null;
}

export function pickNext(memories: readonly Memory[], ctx: SelectionContext): Pick | null {
  const blocked = new Set(ctx.recentCardIds.slice(0, SIBLING_GAP));
  const pick = (allowRecent: boolean): Pick | null => {
    const pool = memories.filter((m) => allowRecent || !blocked.has(m.cardId));

    const learning = pool
      .filter((m) => (m.state.phase === 'learning' || m.state.phase === 'relearning') && ctx.scheduler.isDue(m.state, ctx.now))
      .sort((a, b) => (a.state.due ?? 0) - (b.state.due ?? 0));
    if (learning[0]) return { memoryId: learning[0].id, kind: 'learning' };

    const due: Scored[] = pool
      .filter((m) => m.state.phase === 'review' && ctx.scheduler.isDue(m.state, ctx.now))
      .map((m) => ({ memory: m, r: ctx.scheduler.retrievability(m.state, ctx.now) }))
      .sort((a, b) => (b.r ?? 0) - (a.r ?? 0));

    const fresh = pool
      .filter((m) => m.state.phase === 'new')
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));

    const canIntroduce = fresh[0] !== undefined && newBudget(ctx, due.length) > 0;
    const newTurn = due.length === 0 || ctx.picksSinceNew >= NEW_INTERLEAVE;
    if (canIntroduce && newTurn && fresh[0]) return { memoryId: fresh[0].id, kind: 'new' };

    if (due[0]) return { memoryId: due[0].memory.id, kind: 'review' };
    return null;
  };

  // 只剩同一张卡的内容时，放宽同卡间隔，避免明明有题却显示「没有需要回忆的内容」。
  return pick(false) ?? pick(true);
}

/**
 * 「提前复习」：没有到时间的题时用户仍想再看看。
 * 挑可提取性最低的已学记忆（最需要巩固的）。
 */
export function pickAhead(memories: readonly Memory[], ctx: SelectionContext): Pick | null {
  const blocked = new Set(ctx.recentCardIds.slice(0, SIBLING_GAP));
  const scored = memories
    .filter((m) => m.state.phase !== 'new' && !blocked.has(m.cardId))
    .map((m) => ({ id: m.id, r: ctx.scheduler.retrievability(m.state, ctx.now) ?? 1 }))
    .sort((a, b) => a.r - b.r);
  return scored[0] ? { memoryId: scored[0].id, kind: 'review' } : null;
}
