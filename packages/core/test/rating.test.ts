import { describe, expect, it } from 'vitest';

import { detentPosition, gradeFromValue, resolveSlider, snapToDetent } from '../src';

describe('rating', () => {
  it('maps continuous values to four equal bins', () => {
    expect(gradeFromValue(0)).toBe(1);
    expect(gradeFromValue(0.24)).toBe(1);
    expect(gradeFromValue(0.25)).toBe(2);
    expect(gradeFromValue(0.6)).toBe(3);
    expect(gradeFromValue(1)).toBe(4);
    expect(gradeFromValue(-3)).toBe(1);
    expect(gradeFromValue(7)).toBe(4);
  });

  it('snaps detent positions and maps them back to the same grade', () => {
    expect(snapToDetent(0.1)).toBe(1);
    expect(snapToDetent(0.4)).toBe(2);
    expect(snapToDetent(0.6)).toBe(3);
    expect(snapToDetent(0.9)).toBe(4);
    for (const g of [1, 2, 3, 4] as const) {
      expect(gradeFromValue(detentPosition(g))).toBe(g);
    }
  });

  it('keeps the raw value in continuous mode and the detent position in detent mode', () => {
    expect(resolveSlider('continuous', 0.62)).toEqual({ mode: 'continuous', value: 0.62, grade: 3 });
    expect(resolveSlider('detent', 0.62)).toEqual({ mode: 'detent', value: 2 / 3, grade: 3 });
  });
});
