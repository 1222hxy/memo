import { describe, expect, it } from 'vitest';

import { buildEvent, buildReviewLog, newMemoryState, resolveSlider, Scheduler } from '../src';

describe('events', () => {
  it('builds a complete review log from one review', () => {
    const scheduler = new Scheduler({ mode: 'steady' });
    const shownAt = Date.UTC(2026, 9, 18, 8, 0, 0);
    const outcome = scheduler.review(newMemoryState(), 3, shownAt + 9_000);
    const log = buildReviewLog(
      {
        memoryId: 'm1',
        cardId: 'c1',
        cardVersion: 2,
        device: 'iphone',
        timezone: 'Asia/Shanghai',
        scopeFolderId: null,
        pickKind: 'new',
        entry: 'app',
        offline: false,
        shownAt,
        revealedAt: shownAt + 7_000,
        ratedAt: shownAt + 9_000,
        slider: resolveSlider('continuous', 0.7),
        sliderTrace: [{ t: 0, v: 0 }, { t: 2_000, v: 0.7 }],
      },
      outcome,
      scheduler,
    );
    expect(log.thinkMs).toBe(7_000);
    expect(log.rateMs).toBe(2_000);
    expect(log.grade).toBe(3);
    expect(log.sliderValue).toBe(0.7);
    expect(log.stateBefore.phase).toBe('new');
    expect(log.stateAfter.phase).toBe('learning');
    expect(log.algorithmVersion).toContain('FSRS-6');
    expect(log.mode).toBe('steady');
    expect(log.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('stamps events with an id, time and device', () => {
    const e = buildEvent({ type: 'pause_choice', choice: 'stop' }, 'ipad', 123);
    expect(e).toMatchObject({ type: 'pause_choice', choice: 'stop', device: 'ipad', at: 123 });
  });
});
