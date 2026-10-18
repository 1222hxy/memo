/**
 * 文件夹树。卡片有一个主位置（folderId），还可以关联到其他文件夹（CardLink）。
 * 复习范围选某个文件夹时，包括它所有子文件夹里的卡，以及关联进来的卡。
 */

import type { Folder, Id } from './model';

/** 某个文件夹自己和它所有后代的 ID。已删除的文件夹不算。 */
export function descendantIds(folders: readonly Folder[], rootId: Id): Set<Id> {
  const children = new Map<Id | null, Id[]>();
  for (const f of folders) {
    if (f.deletedAt !== null) continue;
    const list = children.get(f.parentId) ?? [];
    list.push(f.id);
    children.set(f.parentId, list);
  }
  const result = new Set<Id>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (result.has(id)) continue;
    result.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return result;
}

/** 从根到这个文件夹的路径（包括它自己）。 */
export function folderPath(folders: readonly Folder[], id: Id): Folder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: Folder[] = [];
  const seen = new Set<Id>();
  let cur = byId.get(id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return path;
}

/** 把 folderId 移到 newParentId 下面会不会形成环（移到自己或自己的后代里）。 */
export function wouldCreateCycle(folders: readonly Folder[], folderId: Id, newParentId: Id | null): boolean {
  return newParentId !== null && descendantIds(folders, folderId).has(newParentId);
}

export interface CardPlacement {
  cardId: Id;
  folderId: Id;
  linkedFolderIds: readonly Id[];
}

/** 在复习范围内的卡片 ID。scope 为 null 表示全部。 */
export function cardsInScope(
  folders: readonly Folder[],
  placements: readonly CardPlacement[],
  scope: Id | null,
): Set<Id> | null {
  if (scope === null) return null;
  const inScope = descendantIds(folders, scope);
  const result = new Set<Id>();
  for (const p of placements) {
    if (inScope.has(p.folderId) || p.linkedFolderIds.some((f) => inScope.has(f))) result.add(p.cardId);
  }
  return result;
}

/** 按树的顺序展开成带层级的列表，用于选择文件夹。 */
export function flattenTree(folders: readonly Folder[]): { folder: Folder; depth: number }[] {
  const live = folders.filter((f) => f.deletedAt === null);
  const children = new Map<Id | null, Folder[]>();
  for (const f of live) {
    const list = children.get(f.parentId) ?? [];
    list.push(f);
    children.set(f.parentId, list);
  }
  for (const list of children.values()) list.sort(compareFolders);
  const out: { folder: Folder; depth: number }[] = [];
  const walk = (parent: Id | null, depth: number) => {
    for (const f of children.get(parent) ?? []) {
      out.push({ folder: f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function compareFolders(a: Folder, b: Folder): number {
  return a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.name.localeCompare(b.name);
}
