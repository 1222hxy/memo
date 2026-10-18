import { describe, expect, it } from 'vitest';

import { cardsInScope, descendantIds, flattenTree, folderPath, wouldCreateCycle } from '../src/folders';
import type { Folder } from '../src/model';

const folder = (id: string, parentId: string | null, sortKey = id, deletedAt: number | null = null): Folder => ({
  id,
  parentId,
  name: id,
  sortKey,
  createdAt: 0,
  updatedAt: 0,
  deletedAt,
});

// math ─ linear ─ eigen
//      └ calculus
// words
// old (deleted)
const tree = [
  folder('math', null, 'a'),
  folder('linear', 'math', 'a'),
  folder('eigen', 'linear'),
  folder('calculus', 'math', 'b'),
  folder('words', null, 'b'),
  folder('old', null, 'c', 1),
];

describe('folders', () => {
  it('collects all descendants', () => {
    expect(descendantIds(tree, 'math')).toEqual(new Set(['math', 'linear', 'eigen', 'calculus']));
    expect(descendantIds(tree, 'words')).toEqual(new Set(['words']));
  });

  it('builds the path from the root', () => {
    expect(folderPath(tree, 'eigen').map((f) => f.id)).toEqual(['math', 'linear', 'eigen']);
  });

  it('refuses moves into its own subtree', () => {
    expect(wouldCreateCycle(tree, 'math', 'eigen')).toBe(true);
    expect(wouldCreateCycle(tree, 'math', 'math')).toBe(true);
    expect(wouldCreateCycle(tree, 'eigen', 'words')).toBe(false);
    expect(wouldCreateCycle(tree, 'eigen', null)).toBe(false);
  });

  it('includes linked cards in a scope', () => {
    const placements = [
      { cardId: 'c1', folderId: 'eigen', linkedFolderIds: [] },
      { cardId: 'c2', folderId: 'words', linkedFolderIds: ['calculus'] },
      { cardId: 'c3', folderId: 'words', linkedFolderIds: [] },
    ];
    expect(cardsInScope(tree, placements, null)).toBeNull();
    expect(cardsInScope(tree, placements, 'math')).toEqual(new Set(['c1', 'c2']));
    expect(cardsInScope(tree, placements, 'words')).toEqual(new Set(['c2', 'c3']));
  });

  it('flattens in tree order and skips deleted folders', () => {
    expect(flattenTree(tree).map(({ folder: f, depth }) => `${depth}:${f.id}`)).toEqual([
      '0:math',
      '1:linear',
      '2:eigen',
      '1:calculus',
      '0:words',
    ]);
  });
});
