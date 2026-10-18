import { describe, expect, it } from 'vitest';

import { newMemoryState, Scheduler } from '../src';

const DAY = 86_400_000;
const t0 = Date.UTC(2026, 9, 18, 8, 0, 0);

describe('Scheduler', () => {
  const s = new Scheduler({ mode: 'steady' });

  it('uses FSRS-6 and the target retention of the mode', () => {
    expect(s.algorithmVersion).toContain('FSRS-6');
    expect(s.targetRetention).toBe(0.9);
    expect(new Scheduler({ mode: 'relaxed' }).targetRetention).toBe(0.85);
    expect(new Scheduler({ mode: 'sprint' }).targetRetention).toBe(0.95);
  });

  it('puts a new memory into short-term learning after a first review', () => {
    const out = s.review(newMemoryState(), 3, t0);
    expect(out.before.phase).toBe('new');
    expect(out.retrievabilityBefore).toBeNull();
    expect(out.elapsedDays).toBeNull();
    expect(out.after.phase).toBe('learning');
    expect(out.after.reps).toBe(1);
    expect(out.after.lastReview).toBe(t0);
    // 学习步骤 [1m, 10m]：「基本记得」10 分钟后再问。
    expect(out.after.due).toBe(t0 + 10 * 60_000);
  });

  it('graduates to review and lets retrievability decay over time', () => {
    let st = s.review(newMemoryState(), 4, t0).after;
    expect(st.phase).toBe('review');
    const r1 = s.retrievability(st, t0 + DAY)!;
    const r10 = s.retrievability(st, t0 + 10 * DAY)!;
    expect(r1).toBeGreaterThan(r10);
    expect(r1).toBeLessThanOrEqual(1);

    const due = s.isDue(st, t0 + 1000 * DAY);
    expect(due).toBe(true);
    expect(s.isDue(st, t0 + 1)).toBe(false);

    // 一次遗忘：进入重新学习，遗忘次数 +1，稳定性下降。
    const later = t0 + 30 * DAY;
    const out = s.review(st, 1, later);
    expect(out.after.phase).toBe('relearning');
    expect(out.after.lapses).toBe(1);
    expect(out.after.stability).toBeLessThan(st.stability);
    expect(out.elapsedDays).toBeCloseTo(30);
    expect(out.retrievabilityBefore).not.toBeNull();
    st = out.after;
  });

  it('judges review memories by retrievability, so changing mode applies immediately', () => {
    const st = s.review(newMemoryState(), 4, t0).after;
    const relaxed = new Scheduler({ mode: 'relaxed' });
    const sprint = new Scheduler({ mode: 'sprint' });
    // 找一个时刻：R 介于 0.85 和 0.95 之间。
    let at = t0;
    while ((s.retrievability(st, at) ?? 1) > 0.9) at += DAY / 4;
    expect(sprint.isDue(st, at)).toBe(true);
    expect(relaxed.isDue(st, at)).toBe(false);
  });

  it('accepts personal weights', () => {
    const custom = new Scheduler({ mode: 'steady', weightsVersion: 'me-2026-10' });
    expect(custom.weightsVersion).toBe('me-2026-10');
    expect(s.weightsVersion).toBe('default');
  });
});
