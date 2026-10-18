/** 复习模式：用户只选一个，不需要懂算法。 */
export type ReviewMode = 'relaxed' | 'steady' | 'sprint';

export interface ModeConfig {
  label: string;
  /** FSRS 的目标记住比例（request retention）。 */
  targetRetention: number;
  /** 没有积压时，每天最多引入的新记忆数。 */
  newPerDay: number;
}

export const MODES: Record<ReviewMode, ModeConfig> = {
  relaxed: { label: '轻松', targetRetention: 0.85, newPerDay: 5 },
  steady: { label: '平稳', targetRetention: 0.9, newPerDay: 10 },
  sprint: { label: '冲刺', targetRetention: 0.95, newPerDay: 10 },
};

export const DEFAULT_MODE: ReviewMode = 'steady';
