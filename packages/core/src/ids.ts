import { uuidv7 } from 'uuidv7';

import type { Id } from './model';

/** 生成新的 UUIDv7：离线也能生成，按时间有序，便于同步与研究时排序。 */
export function newId(): Id {
  return uuidv7();
}
