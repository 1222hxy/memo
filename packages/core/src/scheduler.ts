import {
  createEmptyCard,
  fsrs,
  FSRSVersion,
  generatorParameters,
  State,
  type Card as FsrsCard,
  type FSRS,
} from 'ts-fsrs';

import type { Millis, MemoryPhase, MemoryState } from './model';
import { MODES, type ReviewMode } from './modes';
import type { Grade } from './rating';

const DAY_MS = 86_400_000;

const PHASE_TO_STATE: Record<MemoryPhase, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};

const STATE_TO_PHASE: Record<State, MemoryPhase> = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning',
};

export interface SchedulerOptions {
  mode: ReviewMode;
  /** 用户个人训练出的 FSRS 参数；不传则用 FSRS-6 默认参数。 */
  weights?: readonly number[];
  /** 个人参数的版本标识，写进复习记录，方便研究时区分。 */
  weightsVersion?: string;
}

export interface ReviewOutcome {
  before: MemoryState;
  after: MemoryState;
  /** 复习那一刻的可提取性；新记忆为 null。 */
  retrievabilityBefore: number | null;
  /** 距上次复习的天数（保留小数）；第一次复习为 null。 */
  elapsedDays: number | null;
  scheduledDays: number;
}

export function newMemoryState(): MemoryState {
  return {
    phase: 'new',
    difficulty: 0,
    stability: 0,
    due: null,
    lastReview: null,
    reps: 0,
    lapses: 0,
    learningSteps: 0,
    scheduledDays: 0,
  };
}

function toFsrsCard(s: MemoryState, now: Millis): FsrsCard {
  if (s.phase === 'new') return createEmptyCard(new Date(now));
  return {
    due: new Date(s.due ?? now),
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: 0,
    scheduled_days: s.scheduledDays,
    learning_steps: s.learningSteps,
    reps: s.reps,
    lapses: s.lapses,
    state: PHASE_TO_STATE[s.phase],
    ...(s.lastReview != null ? { last_review: new Date(s.lastReview) } : {}),
  };
}

function fromFsrsCard(c: FsrsCard): MemoryState {
  return {
    phase: STATE_TO_PHASE[c.state],
    difficulty: c.difficulty,
    stability: c.stability,
    due: c.due.getTime(),
    lastReview: c.last_review ? c.last_review.getTime() : null,
    reps: c.reps,
    lapses: c.lapses,
    learningSteps: c.learning_steps,
    scheduledDays: c.scheduled_days,
  };
}

/** FSRS 排程的薄封装：其余代码只认 MemoryState，不直接依赖 ts-fsrs。 */
export class Scheduler {
  readonly mode: ReviewMode;
  readonly targetRetention: number;
  /** 写进复习记录的算法版本，例如 "ts-fsrs v5.4.2 using FSRS-6.0"。 */
  readonly algorithmVersion: string = `ts-fsrs ${FSRSVersion}`;
  readonly weightsVersion: string;
  private readonly f: FSRS;

  constructor(options: SchedulerOptions) {
    this.mode = options.mode;
    this.targetRetention = MODES[options.mode].targetRetention;
    this.weightsVersion = options.weightsVersion ?? 'default';
    this.f = fsrs(
      generatorParameters({
        request_retention: this.targetRetention,
        // 关闭随机扰动：复习记录可复现，便于研究；选题本身不依赖 due 日期。
        enable_fuzz: false,
        enable_short_term: true,
        ...(options.weights ? { w: [...options.weights] } : {}),
      }),
    );
  }

  /** 此刻能想起来的概率（0–1）；新记忆没有意义，返回 null。 */
  retrievability(state: MemoryState, now: Millis): number | null {
    if (state.phase === 'new') return null;
    return this.f.get_retrievability(toFsrsCard(state, now), new Date(now), false);
  }

  /** 此刻是否值得复习（新记忆是否引入由选题逻辑决定，这里返回 false）。 */
  isDue(state: MemoryState, now: Millis): boolean {
    switch (state.phase) {
      case 'new':
        return false;
      case 'learning':
      case 'relearning':
        return (state.due ?? now) <= now;
      case 'review':
        return (this.retrievability(state, now) ?? 0) <= this.targetRetention;
    }
  }

  review(state: MemoryState, grade: Grade, now: Millis): ReviewOutcome {
    const card = toFsrsCard(state, now);
    const retrievabilityBefore = this.retrievability(state, now);
    const { card: next } = this.f.next(card, new Date(now), grade);
    return {
      before: state,
      after: fromFsrsCard(next),
      retrievabilityBefore,
      elapsedDays: state.lastReview != null ? (now - state.lastReview) / DAY_MS : null,
      scheduledDays: next.scheduled_days,
    };
  }
}
