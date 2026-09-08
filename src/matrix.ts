import type { Part, PartsList } from './types';
import { partKey } from './csv';

const natural = new Intl.Collator('ja', {
  numeric: true,
  sensitivity: 'base',
});

/**
 * PL columns in the reference workbook are ordered by PL number, rather than by
 * the order in which the browser happens to return selected files.
 */
export function sortPartsLists(lists: PartsList[]): PartsList[] {
  return [...lists].sort((a, b) => {
    const left = (a.plNo || a.fileName).toUpperCase();
    const right = (b.plNo || b.fileName).toUpperCase();
    // Excel's ascending text order puts the numeric part of these fixed-format
    // PL numbers before alphabetic variants (HH1100... before HH110A...).
    if (left < right) return -1;
    if (left > right) return 1;
    return natural.compare(a.plVersion || '', b.plVersion || '');
  });
}

export const isStandardPl = (plNo: string): boolean => /^HH1/i.test(plNo.trim());

/** `Z` で始まる品番は購入品。部品表で見分けられるよう色を変える。 */
export const isPurchasedPart = (partNo: string): boolean => /^Z/i.test(partNo.trim());

export const setListsVisibilityByMode = (lists: PartsList[], modeId: string, visible: boolean): PartsList[] =>
  lists.map(list => list.modeId === modeId ? { ...list, visible } : list);

export const filterPartsByBalloon = (parts: Part[], balloon: string): Part[] =>
  balloon === 'all' ? parts : parts.filter(part => part.balloon === balloon);

export const filterSupplementParts = (parts: Part[], showSupplements: boolean): Part[] =>
  showSupplements ? parts : parts.filter(part => part.partNo.trim() !== '+');

/** Return the actual number of matching detail rows in a PL. */
export const countPartOccurrences = (list: PartsList, part: Part): number => {
  const key = partKey(part);
  return list.parts.filter(item => item.balloon.toUpperCase() !== 'C' && partKey(item) === key).length;
};

export type PlSimilarity = { list: PartsList; score: number; common: number; union: number };

export type PlPartComparison = { common: Part[]; baseOnly: Part[]; targetOnly: Part[] };

export function comparePlParts(base: PartsList, target: PartsList): PlPartComparison {
  const uniqueParts = (list: PartsList) => new Map(
    list.parts.filter(part => part.balloon.toUpperCase() !== 'C').map(part => [partKey(part), part]),
  );
  const baseParts = uniqueParts(base);
  const targetParts = uniqueParts(target);
  return {
    common: [...baseParts].filter(([key]) => targetParts.has(key)).map(([, part]) => part),
    baseOnly: [...baseParts].filter(([key]) => !targetParts.has(key)).map(([, part]) => part),
    targetOnly: [...targetParts].filter(([key]) => !baseParts.has(key)).map(([, part]) => part),
  };
}

export function calculatePlSimilarities(lists: PartsList[], baseId: string): PlSimilarity[] {
  const base = lists.find(list => list.id === baseId);
  if (!base) return [];
  const baseKeys = new Set(base.parts.filter(part => part.balloon.toUpperCase() !== 'C').map(partKey));
  return lists.map(list => {
    const keys = new Set(list.parts.filter(part => part.balloon.toUpperCase() !== 'C').map(partKey));
    const common = [...baseKeys].filter(key => keys.has(key)).length;
    const union = new Set([...baseKeys, ...keys]).size;
    return { list, common, union, score: union ? common / union : 1 };
  }).sort((a, b) => {
    const scoreDifference = b.score - a.score;
    if (scoreDifference) return scoreDifference;
    if (a.list.id === b.list.id) return 0;
    return sortPartsLists([a.list, b.list])[0].id === a.list.id ? -1 : 1;
  });
}

export function collectPartsInSourceOrder(lists: PartsList[]): Part[] {
  const unique = new Map<string, Part>();
  for (const list of lists) {
    for (const part of list.parts) {
      const key = partKey(part);
      if (part.balloon.toUpperCase() !== 'C' && !unique.has(key)) unique.set(key, part);
    }
  }
  return sortPartsByBalloon([...unique.values()]);
}

export function buildBalloonGroups(parts: Part[]): { index: number; start: boolean }[] {
  let groupIndex = 0;
  return parts.map((part, rowIndex) => {
    const start = rowIndex === 0 || part.balloon !== parts[rowIndex - 1].balloon;
    if (start && rowIndex > 0) groupIndex += 1;
    return { index: groupIndex, start };
  });
}

/**
 * Match the workbook's primary sort: numeric balloons first in ascending order.
 * Returning zero for an equal balloon intentionally preserves first appearance
 * order within each balloon (Array#sort is stable in supported browsers).
 */
export function sortPartsByBalloon(parts: Part[]): Part[] {
  return parts
    .map((part, index) => ({ part, index }))
    .sort((a, b) => {
      const left = balloonRank(a.part.balloon);
      const right = balloonRank(b.part.balloon);
      if (left.group !== right.group) return left.group - right.group;
      if (left.group === 0 && left.value !== right.value) {
        return left.value - right.value;
      }
      if (left.group === 1) {
        const compared = natural.compare(a.part.balloon, b.part.balloon);
        if (compared) return compared;
      }
      return a.index - b.index;
    })
    .map(({ part }) => part);
}

function balloonRank(balloon: string): { group: number; value: number } {
  const value = Number(balloon.trim());
  if (balloon.trim() !== '' && Number.isFinite(value)) return { group: 0, value };
  if (balloon.trim() !== '') return { group: 1, value: 0 };
  return { group: 2, value: 0 };
}
