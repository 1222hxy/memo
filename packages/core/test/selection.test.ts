import { describe, expect, it } from 'vitest';

import {
  BACKLOG_LIMIT,
  isHardToRemember,
  newMemoryState,
  pickAhead,
  pickNext,
  Scheduler,
  shouldOfferPause,
  type Memory,
  type MemoryState,
  type SelectionContext,
} from '../src';

const DAY = 86_400_000;
const t0 = Date.UTC(2026, 9, 18, 8, 0, 0);
const scheduler = new Scheduler({ mode: 'steady' });

let seq = 0;
function memory(cardId: string, state: MemoryState = newMemoryState()): Memory {
  seq += 1;
  return { id: `m${seq}`, cardId, masks: [], state, introducedAt: null, createdAt: t0 + seq };
}

/** 一个在 t0 学会、此后不断遗忘的记忆。 */
const learnedAt = (at: number) => scheduler.review(newMemoryState(), 4, at).after;

function ctx(overrides: Partial<SelectionContext> = {}): SelectionContext {
  return { now: t0 + 60 * DAY, scheduler, recentCardIds: [], newIntroducedToday: 0, picksSinceNew: 0, ...overrides };
}

describe('pickNext', () => {
  it('returns null when nothing is worth reviewing', () => {
    expect(pickNext([], ctx())).toBeNull();
    const fresh = memory('c1', learnedAt(t0));
    expect(pickNext([fresh], ctx({ now: t0 + 1 }))).toBeNull();
  });

  it('puts short-term learning steps first', () => {
    const learning = memory('c1', scheduler.review(newMemoryState(), 3, t0).after);
    const old = memory('c2', learnedAt(t0 - 100 * DAY));
    const pick = pickNext([old, learning], ctx({ now: t0 + 11 * 60_000 }));
    expect(pick).toEqual({ memoryId: learning.id, kind: 'learning' });
  });

  it('prefers the due memory closest to the threshold (highest retrievability)', () => {
    const veryOld = memory('c1', learnedAt(t0 - 300 * DAY));
    const justDue = memory('c2', learnedAt(t0 - 20 * DAY));
    const pick = pickNext([veryOld, justDue], ctx({ now: t0, picksSinceNew: 0 }));
    expect(pick).toEqual({ memoryId: justDue.id, kind: 'review' });
  });

  it('keeps siblings of recently reviewed cards apart, unless nothing else is left', () => {
    const a = memory('same', learnedAt(t0 - 20 * DAY));
    const b = memory('other', learnedAt(t0 - 300 * DAY));
    expect(pickNext([a, b], ctx({ now: t0, recentCardIds: ['same'] }))?.memoryId).toBe(b.id);
    expect(pickNext([a], ctx({ now: t0, recentCardIds: ['same'] }))?.memoryId).toBe(a.id);
  });

  it('introduces new memories when nothing is due, and interleaves them otherwise', () => {
    const n = memory('c1');
    expect(pickNext([n], ctx())).toEqual({ memoryId: n.id, kind: 'new' });

    const due = memory('c2', learnedAt(t0 - 100 * DAY));
    expect(pickNext([n, due], ctx({ picksSinceNew: 0 }))?.kind).toBe('review');
    expect(pickNext([n, due], ctx({ picksSinceNew: 4 }))?.kind).toBe('new');
  });

  it('respects the daily new budget and pauses new memories under a backlog', () => {
    const n = memory('c1');
    expect(pickNext([n], ctx({ newIntroducedToday: 10 }))).toBeNull();

    const backlog = Array.from({ length: BACKLOG_LIMIT }, (_, i) => memory(`b${i}`, learnedAt(t0 - 100 * DAY)));
    const pick = pickNext([n, ...backlog], ctx({ picksSinceNew: 99 }));
    expect(pick?.kind).toBe('review');
  });
});

describe('pickAhead', () => {
  it('chooses the learned memory with the lowest retrievability', () => {
    const recent = memory('c1', learnedAt(t0));
    const older = memory('c2', learnedAt(t0 - 2 * DAY));
    expect(pickAhead([recent, older, memory('c3')], ctx({ now: t0 + 1 }))?.memoryId).toBe(older.id);
  });
});

describe('flow', () => {
  it('offers a pause after a full segment or when the due work runs out', () => {
    expect(shouldOfferPause(0, false)).toBe(false);
    expect(shouldOfferPause(3, true)).toBe(false);
    expect(shouldOfferPause(3, false)).toBe(true);
    expect(shouldOfferPause(12, true)).toBe(true);
  });

  it('flags memories that keep being forgotten', () => {
    const st: MemoryState = { ...newMemoryState(), phase: 'review', lapses: 4, stability: 2 };
    expect(isHardToRemember(st)).toBe(true);
    expect(isHardToRemember({ ...st, stability: 30 })).toBe(false);
    expect(isHardToRemember({ ...st, lapses: 1 })).toBe(false);
  });
});
