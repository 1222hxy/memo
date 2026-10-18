/** 复习节奏相关的温和规则：一小段何时结束、哪些卡难记。 */

import type { MemoryState } from './model';

/** 一小段的默认题数。 */
export const SEGMENT_SIZE = 12;

/**
 * 是否在题目流里插入「到此为止 / 继续学一会」卡片。
 * 一小段做满，或者值得复习的内容已经告一段落时出现；一题都没做时不出现。
 */
export function shouldOfferPause(reviewedInSegment: number, hasMoreDue: boolean): boolean {
  if (reviewedInSegment <= 0) return false;
  return reviewedInSegment >= SEGMENT_SIZE || !hasMoreDue;
}

/** 忘记至少这么多次… */
export const LEECH_LAPSES = 4;
/** …且稳定性仍低于这么多天，就认为是「难记卡」。 */
export const LEECH_MAX_STABILITY_DAYS = 7;

/** 难记卡：问题多半在卡片本身，提示用户拆小或换个问法，而不是责怪用户。 */
export function isHardToRemember(state: MemoryState): boolean {
  return state.lapses >= LEECH_LAPSES && state.stability < LEECH_MAX_STABILITY_DAYS;
}
