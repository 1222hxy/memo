/**
 * Memo 的数据模型。
 *
 * 所有时间都用 Unix 毫秒时间戳（number），方便直接存进 SQLite / Postgres 并跨设备同步。
 * 所有 ID 都是 UUIDv7（见 ids.ts）：离线可生成，并自带时间顺序。
 */

export type Id = string;
export type Millis = number;

export type DeviceKind = 'iphone' | 'ipad' | 'windows' | 'web';

/** 嵌套文件夹。parentId 为 null 表示根目录。 */
export interface Folder {
  id: Id;
  parentId: Id | null;
  name: string;
  /** 同级排序用的字符串键（便于在两项之间插入而不重排其他项）。 */
  sortKey: string;
  createdAt: Millis;
  updatedAt: Millis;
  deletedAt: Millis | null;
}

/** 一张卡 = 一页自由内容（若干 Block）+ 若干遮盖（每组遮盖是一个 Memory）。 */
export interface Card {
  id: Id;
  /** 主位置。 */
  folderId: Id;
  /** 每次内容被编辑时 +1，复习记录会记下当时的版本。 */
  version: number;
  suspended: boolean;
  createdAt: Millis;
  updatedAt: Millis;
  deletedAt: Millis | null;
}

/** 卡片被「关联」到主位置以外的文件夹（引用，不是复制）。 */
export interface CardLink {
  id: Id;
  cardId: Id;
  folderId: Id;
  createdAt: Millis;
}

export type BlockType = 'text' | 'math' | 'code' | 'image' | 'ink' | 'audio';

/**
 * 卡片里的一块内容，同步的最小单位：不同块的修改可以自动合并。
 * - text: Markdown 源码
 * - math: LaTeX 源码
 * - code: `{ lang, source }` 的 JSON
 * - image / audio: `{ hash, mime, width?, height?, durationMs? }` 的 JSON，文件按内容哈希存放
 * - ink: 一组笔画的 JSON（笔画只增不改）
 */
export interface Block {
  id: Id;
  cardId: Id;
  type: BlockType;
  content: string;
  sortKey: string;
  updatedAt: Millis;
}

/** 遮盖的目标。坐标统一归一化到 0–1，适配不同屏幕尺寸。 */
export type MaskTarget =
  | { kind: 'block'; blockId: Id }
  | { kind: 'text-range'; blockId: Id; start: number; end: number }
  | { kind: 'region'; blockId: Id; x: number; y: number; w: number; h: number };

export type MemoryPhase = 'new' | 'learning' | 'review' | 'relearning';

/** 一个记忆的 FSRS 状态。 */
export interface MemoryState {
  phase: MemoryPhase;
  /** 难度 D（1–10）。新记忆为 0。 */
  difficulty: number;
  /** 稳定性 S（天）。新记忆为 0。 */
  stability: number;
  /**
   * FSRS 算出的下次复习时间。learning / relearning 阶段按它判断是否该复习；
   * review 阶段以「此刻的可提取性是否低于目标」为准（换模式后立刻生效），due 只作参考。
   */
  due: Millis | null;
  lastReview: Millis | null;
  reps: number;
  lapses: number;
  learningSteps: number;
  scheduledDays: number;
}

/** 一个记忆 = 一张卡上的一组遮盖，复习和排程的基本单位。 */
export interface Memory {
  id: Id;
  cardId: Id;
  masks: MaskTarget[];
  state: MemoryState;
  /** 第一次进入复习的时间；还没引入时为 null。 */
  introducedAt: Millis | null;
  createdAt: Millis;
}
