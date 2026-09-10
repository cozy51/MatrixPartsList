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

/** 機種コードが `HH0`・`HH1`・`HJ0` のPLは標準PL。一覧とヘッダーに `STD` を表示する。 */
export const isStandardPl = (plNo: string): boolean => /^(HH0|HH1|HJ0)/i.test(plNo.trim());

/** 機種コードが `HH3`・`HJ3` のPLは客先特殊PL。一覧とヘッダーに `CST` を表示する。 */
export const isCustomerSpecialPl = (plNo: string): boolean => /^(HH3|HJ3)/i.test(plNo.trim());

/**
 * PL番号から、一覧・ヘッダー・ツールチップに出す略称を返す。標準でも客先特殊でも
 * ないPLは空文字。表示側はこの1か所を見れば、どちらの印を出すか決められる。
 */
export const plKindLabel = (plNo: string): string =>
  isStandardPl(plNo) ? 'STD' : isCustomerSpecialPl(plNo) ? 'CST' : '';

/** `Z` で始まる品番は購入品。部品表で見分けられるよう色を変える。 */
export const isPurchasedPart = (partNo: string): boolean => /^Z/i.test(partNo.trim());

/** 数量を除いた部品の同一性。同じ部品なのに個数だけが違う行を見つけるのに使う。 */
export const partKeyWithoutQuantity = (part: Part): string =>
  [part.balloon, part.partNo, part.version, part.name, part.material].join('\u001f').toLocaleUpperCase();

/**
 * 同じ部品で個数だけが違う行のまとまり。値はその部品に現れる個数（昇順）。
 * 補材（`+`）は品名で現物を区別しており、同じ品名でも数量が違って当然のため
 * 対象にしない。
 */
export function buildQuantityConflicts(parts: Part[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const part of parts) {
    if (isSupplementPart(part.partNo)) continue;
    const key = partKeyWithoutQuantity(part);
    const quantity = part.quantity.trim();
    const found = groups.get(key);
    if (!found) groups.set(key, [quantity]);
    else if (!found.includes(quantity)) found.push(quantity);
  }
  for (const [key, quantities] of groups) {
    if (quantities.length < 2) groups.delete(key);
    else quantities.sort((a, b) => (Number(a) || 0) - (Number(b) || 0) || natural.compare(a, b));
  }
  return groups;
}

/** 材質・メーカーを除いた部品の同一性。材質欄だけが違う行を見つけるのに使う。 */
export const partKeyWithoutMaterial = (part: Part): string =>
  [part.balloon, part.partNo, part.version, part.name, part.quantity].join('\u001f').toLocaleUpperCase();

/**
 * 同じ部品で材質・メーカーだけが違う行のまとまり。値はその部品に現れる材質。
 * 通常は起こらないが、起きていれば知っておきたい情報なので強調する。補材（`+`）は
 * 品名で現物を区別しており、材質欄が空のことも多いため対象にしない。
 */
export function buildMaterialConflicts(parts: Part[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const part of parts) {
    if (isSupplementPart(part.partNo)) continue;
    const key = partKeyWithoutMaterial(part);
    const material = part.material.trim();
    const found = groups.get(key);
    if (!found) groups.set(key, [material]);
    else if (!found.includes(material)) found.push(material);
  }
  for (const [key, materials] of groups) {
    if (materials.length < 2) groups.delete(key);
    else materials.sort((a, b) => natural.compare(a, b));
  }
  return groups;
}

/**
 * 同じ品番でVer.だけが違う行のまとまり。値はその品番に現れるVer.（昇順）。
 * 品番も品名も同じで、Ver.の1文字だけが違う行は隣どうしに並ぶため見落としやすい。
 * 拾い漏らしを防ぐため、まとめて強調できるように集めておく。
 * 補材（`+`）は品番を持たないため対象にしない。
 */
export function buildVersionConflicts(parts: Part[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const part of parts) {
    if (isSupplementPart(part.partNo)) continue;
    const key = part.partNo.trim().toUpperCase();
    const version = part.version.trim() || '-';
    const found = groups.get(key);
    if (!found) groups.set(key, [version]);
    else if (!found.includes(version)) found.push(version);
  }
  for (const [key, versions] of groups) {
    if (versions.length < 2) groups.delete(key);
    else versions.sort((a, b) => natural.compare(a, b));
  }
  return groups;
}

/**
 * 部品図（9文字目が `5`・`6`）と組立図の `4` は、末尾の1桁が違っても互換性が
 * あります。末尾1桁は10桁の品番なら10桁目、11桁の品番なら11桁目で、11桁目の方が
 * より詳細な違い（同じ10桁目の中での枝番）を表します。末尾1桁を除いた部分を
 * 「基本番号」として、互換の部品をまとめます。ただし機種CDが
 * WIDE_COMPATIBLE_MACHINE_CODES のものは、10桁目・11桁目のどちらの違いでも
 * 互換のため、先頭9桁を基本番号にします。
 * PL（`1`）は10桁目が違えば別のユニットなので、CAD IDの方で扱います。
 */
const COMPATIBLE_CATEGORY_CODES = new Set(['4', '5', '6']);

/**
 * 同じ品番が複数の風船番号に現れる場合のまとまり。値はその品番が現れる風船番号（昇順）。
 * 誤りではないが、品番は風船ごとにユニークな方が扱いやすいため、気づけるようにする。
 * 補材（`+`）は品名で現物を区別しており、品番を持たないため対象にしない。
 */
export function buildBalloonDuplicates(parts: Part[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const part of parts) {
    if (isSupplementPart(part.partNo)) continue;
    const key = part.partNo.trim().toUpperCase();
    const balloon = part.balloon.trim();
    const found = groups.get(key);
    if (!found) groups.set(key, [balloon]);
    else if (!found.includes(balloon)) found.push(balloon);
  }
  for (const [key, balloons] of groups) {
    if (balloons.length < 2) groups.delete(key);
    else balloons.sort((a, b) => (Number(a) || 0) - (Number(b) || 0) || natural.compare(a, b));
  }
  return groups;
}

/**
 * 10桁目・11桁目のどちらが違っても互換になる機種CD（品番の先頭3文字）。
 * 11桁の品番は通常、11桁目だけの違いを互換とするが、これらの機種CDは10桁目の
 * 違いも互換のため、先頭9桁を基本番号にする。
 */
export const WIDE_COMPATIBLE_MACHINE_CODES = new Set(['HM0', 'HM1']);

export function compatibleBaseNo(partNo: string): string {
  const value = partNo.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]{9,10}$/.test(value)) return '';
  if (!COMPATIBLE_CATEGORY_CODES.has(value[8])) return '';
  return WIDE_COMPATIBLE_MACHINE_CODES.has(value.slice(0, 3)) ? value.slice(0, 9) : value.slice(0, -1);
}

/**
 * 互換品どうしで違う桁の呼び名（`10桁目`、`11桁目`、`10・11桁目`）。
 * 基本番号より後ろの桁がすべて違いのある桁になる。
 */
export function compatibleDigitLabel(partNo: string): string {
  const base = compatibleBaseNo(partNo);
  const value = partNo.trim();
  if (!base || base.length >= value.length) return '';
  const digits = [];
  for (let index = base.length; index < value.length; index++) digits.push(index + 1);
  return `${digits.join('・')}桁目`;
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

/**
 * PL1件分の索引。部品ごとの件数（`counts`）と、載っている部品のキー（`keys`）を
 * 1回の走査で作る。マトリックスは「部品 × PL」のすべての組を数えるため、PLごとに
 * 明細を数え直すと部品数 × PL数 × 明細数の照合になり、PLが増えるほど描画が重く
 * なる。PLごとに1回だけ数えておき、あとは品番のキーで引く。
 */
export type ListPartIndex = { counts: Map<string, number>; keys: Set<string> };

export function buildListPartIndex(list: PartsList): ListPartIndex {
  const counts = new Map<string, number>();
  const keys = new Set<string>();
  for (const item of list.parts) {
    const key = partKey(item);
    keys.add(key);
    // 補材（風船 C）は員数に数えない。
    if (item.balloon.toUpperCase() === 'C') continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return { counts, keys };
}

/** Return the actual number of matching detail rows in a PL. */
export const countPartOccurrences = (list: PartsList, part: Part): number =>
  buildListPartIndex(list).counts.get(partKey(part)) ?? 0;

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
