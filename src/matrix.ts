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

/**
 * 部品図（品番の9文字目が `5`・`6`）は、10桁目が違っても互換性があります。
 * 10桁目を除いた先頭9桁を「基本番号」として、互換の部品をまとめます。
 */
export function compatibleBaseNo(partNo: string): string {
  const value = partNo.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]{9}$/.test(value)) return '';
  return value[8] === '5' || value[8] === '6' ? value.slice(0, 9) : '';
}

/** 基本番号ごとに品番をまとめる。10桁目だけが違う品番が2つ以上あるものだけを返す。 */
export function buildCompatibleGroups(parts: Part[]): Map<string, string[]> {
  const groups = collectByBaseNo(parts);
  for (const [base, partNos] of groups) {
    if (partNos.length < 2) groups.delete(base);
    else partNos.sort();
  }
  return groups;
}

/** 1つのPLについて、基本番号 → そのPLにある品番 の索引を作る。互換品の表示に使う。 */
export const buildListCompatibleIndex = (list: PartsList): Map<string, string[]> =>
  collectByBaseNo(list.parts.filter(part => part.balloon.toUpperCase() !== 'C'));

function collectByBaseNo(parts: Part[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const part of parts) {
    const base = compatibleBaseNo(part.partNo);
    if (!base) continue;
    const partNo = part.partNo.trim().toUpperCase();
    const found = groups.get(base);
    if (!found) groups.set(base, [partNo]);
    else if (!found.includes(partNo)) found.push(partNo);
  }
  return groups;
}

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

/** 品番が `+` の行は補材（端材）。同じ風船番号の中では最後に並べる。 */
export const isSupplementPart = (partNo: string): boolean => partNo.trim() === '' || partNo.trim() === '+';

/**
 * Match the workbook's primary sort: numeric balloons first in ascending order.
 * 同じ風船番号の中は品番の昇順に並べ、補材（`+`）は最後へ置く。補材どうしは
 * 読み込んだ順のまま（Array#sort is stable in supported browsers）。
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
      const compared = comparePartNos(a.part.partNo, b.part.partNo);
      if (compared) return compared;
      return a.index - b.index;
    })
    .map(({ part }) => part);
}

/** 品番の昇順。補材（`+`）は品番を持たないため、常に後ろへ回す。 */
function comparePartNos(a: string, b: string): number {
  const leftSupplement = isSupplementPart(a);
  const rightSupplement = isSupplementPart(b);
  if (leftSupplement !== rightSupplement) return leftSupplement ? 1 : -1;
  if (leftSupplement) return 0;
  // 固定書式の品番はExcelの昇順（文字コード順）と同じ並びになる。
  const left = a.trim().toUpperCase();
  const right = b.trim().toUpperCase();
  return left < right ? -1 : left > right ? 1 : 0;
}

function balloonRank(balloon: string): { group: number; value: number } {
  const value = Number(balloon.trim());
  if (balloon.trim() !== '' && Number.isFinite(value)) return { group: 0, value };
  if (balloon.trim() !== '') return { group: 1, value: 0 };
  return { group: 2, value: 0 };
}
