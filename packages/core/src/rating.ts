/**
 * 自评：两种滑块模式最终都换算成 FSRS 的四档评分。
 * 滑块原始值（0–1）始终保留在复习记录里，供以后研究更细粒度的自评。
 */

export type Grade = 1 | 2 | 3 | 4;

export const GRADES: readonly Grade[] = [1, 2, 3, 4];

export const GRADE_LABELS: Record<Grade, string> = {
  1: '完全忘记',
  2: '回忆困难',
  3: '基本记得',
  4: '轻松回忆',
};

/** detent = 四个档位；continuous = 连续滑动。 */
export type SliderMode = 'detent' | 'continuous';

export interface SliderResult {
  mode: SliderMode;
  /** 松手时的位置，0 = 最左，1 = 最右。 */
  value: number;
  grade: Grade;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 连续值按四等分换算成档位。 */
export function gradeFromValue(value: number): Grade {
  const v = clamp01(value);
  if (v < 0.25) return 1;
  if (v < 0.5) return 2;
  if (v < 0.75) return 3;
  return 4;
}

/** 档位在滑轨上的位置：0、1/3、2/3、1。 */
export function detentPosition(grade: Grade): number {
  return (grade - 1) / 3;
}

/** 档位模式下，把拖动位置吸附到最近的档位。 */
export function snapToDetent(value: number): Grade {
  return (Math.round(clamp01(value) * 3) + 1) as Grade;
}

/** 根据滑块模式，把松手位置换算成最终结果。 */
export function resolveSlider(mode: SliderMode, value: number): SliderResult {
  const v = clamp01(value);
  if (mode === 'detent') {
    const grade = snapToDetent(v);
    return { mode, value: detentPosition(grade), grade };
  }
  return { mode, value: v, grade: gradeFromValue(v) };
}
