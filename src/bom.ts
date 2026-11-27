import * as XLSX from 'xlsx';
import { normalizePlVersion, partKey, versionMatchKey } from './csv';
import { parseAmount, partFactFor, type PartFact, type PartFile } from './drawings';
import { isLevel40No, levelNoKey, partLevelOf } from './levels';
import { excludeNoteParts, isPurchasedPart, isSupplementPart, sortPartsByBalloon } from './matrix';
import type { Part, PartsList } from './types';
import { UNITBASE_NOTE_COLUMN, UNITBASE_STATUS_COLUMN, type UnitBaseLookup } from './unitbase';

/**
 * 明細のVer.と一致する40レベル部品の中身（50/60レベル）を返します。
 * 登録がない・Ver.が違うときは undefined を返してください。
 */
export type Level40Parts = (partNo: string, version: string) => Part[] | undefined;

/**
 * 質量・単価がどこから来た値かを表します。
 * - `input`: 単体BOMで手入力した値
 * - `csv`: CSV・Excelから読み込んだ単品質量
 * - `children`: 40レベル部品の中身（50/60レベル）の合計
 * - `none`: 値がない（補材・未入力）
 */
export type AmountSource = 'input' | 'csv' | 'children' | 'none';

/** 中身から合計したときの内訳。何部品ぶんを数えたかを注記に出すために持つ。 */
export type ChildSummary = { parts: number; massCounted: number; priceCounted: number };

export type UnitAmounts = {
  mass: number | undefined;
  price: number | undefined;
  massSource: AmountSource;
  priceSource: AmountSource;
  childSummary?: ChildSummary;
};

export type BomRow = {
  part: Part;
  /** 手入力した単品質量・単価。空のときはCSVの値、または中身の合計を使う。 */
  massInput: string;
  priceInput: string;
  shaiUrl: string;
  /** その他ファイル（説明付き・複数）。 */
  files: PartFile[];
  /** UnitBaseから取り込んだchemSHERPA調査状況・備考。品番（子品番単位）が一致したものだけ入る。 */
  chemStatus: string;
  chemNote: string;
  /** CSV・Excelから読み込んだ単品質量。手入力していないことが分かるよう、目安として出す。 */
  csvMass: string;
  unitMass: number | undefined;
  unitPrice: number | undefined;
  massSource: AmountSource;
  priceSource: AmountSource;
  childSummary?: ChildSummary;
  /** 合計＝単品質量・単価 × 数量。どちらかが数として読めないときは undefined。 */
  totalMass: number | undefined;
  totalPrice: number | undefined;
};

const NO_AMOUNTS: UnitAmounts = { mass: undefined, price: undefined, massSource: 'none', priceSource: 'none' };

/** 同じ40レベルが入れ子で現れたときに数え続けないよう、番号とVer.で見分ける。 */
const level40Key = (part: Part) => `${levelNoKey(part.partNo)}${versionMatchKey(part.version)}`;

/**
 * 1部品ぶんの質量・単価を求めます。
 *
 * **40レベル部品（9桁目が `4`）は分解できる部品**のため、単体で質量・単価を持ちません。
 * 中身（50/60レベル）が登録されていれば、その合計を単品の値とします。中身にさらに
 * 40レベルがあれば、同じ規則で下まで合計します。
 * それ以外の部品は、手入力した値 → CSV・Excelの単品質量、の順に使います。
 */
export function unitAmounts(part: Part, facts: PartFact[], level40Parts: Level40Parts, seen: ReadonlySet<string> = new Set()): UnitAmounts {
  /* 補材（`+`）は品番で見分けられないため、品番ごとの値を持たせない。 */
  if (isSupplementPart(part.partNo)) return NO_AMOUNTS;

  const key = level40Key(part);
  const level40 = isLevel40No(part.partNo);
  const children = level40 && !seen.has(key) ? level40Parts(part.partNo, part.version) : undefined;
  if (children) {
    const nested = new Set(seen).add(key);
    const parts = excludeNoteParts(children);
    let mass = 0, price = 0, massCounted = 0, priceCounted = 0;
    for (const child of parts) {
      const quantity = parseAmount(child.quantity);
      if (quantity === undefined) continue;
      const amounts = unitAmounts(child, facts, level40Parts, nested);
      if (amounts.mass !== undefined) { mass += amounts.mass * quantity; massCounted += 1; }
      if (amounts.price !== undefined) { price += amounts.price * quantity; priceCounted += 1; }
    }
    return {
      /* 中身に1件も値がないときは、0kg・0円ではなく「値なし」として扱う。 */
      mass: massCounted ? mass : undefined,
      price: priceCounted ? price : undefined,
      massSource: 'children',
      priceSource: 'children',
      childSummary: { parts: parts.length, massCounted, priceCounted },
    };
  }

  /* 40レベル自身に登録した値を使うと、中身が未登録でも見かけ上は金額・質量が
     揃ってしまう。登録がない場合も入力値やCSV値にはフォールバックせず、
     「中身の合計（未登録）」として扱う。循環参照で再登場した場合も同様。 */
  if (level40) return { ...NO_AMOUNTS, massSource: 'children', priceSource: 'children' };

  const fact = partFactFor(facts, part.partNo);
  const input = parseAmount(fact?.mass ?? ''), csv = parseAmount(part.unitMass ?? ''), price = parseAmount(fact?.price ?? '');
  return {
    mass: input ?? csv,
    price,
    massSource: input !== undefined ? 'input' : csv !== undefined ? 'csv' : 'none',
    priceSource: price !== undefined ? 'input' : 'none',
  };
}

/** 単体BOM・40レベルの中身に並べる1行ぶんの値をまとめて作る。 */
export function buildBomRows(parts: Part[], facts: PartFact[], level40Parts: Level40Parts, unitBase?: UnitBaseLookup): BomRow[] {
  return parts.map(part => {
    const supplement = isSupplementPart(part.partNo);
    const fact = supplement ? undefined : partFactFor(facts, part.partNo);
    const amounts = unitAmounts(part, facts, level40Parts);
    const quantity = parseAmount(part.quantity);
    const chem = supplement ? undefined : unitBase?.(part.partNo);
    return {
      part,
      massInput: fact?.mass ?? '',
      priceInput: fact?.price ?? '',
      shaiUrl: fact?.shaiUrl ?? '',
      files: fact?.files ?? [],
      chemStatus: chem?.status ?? '',
      chemNote: chem?.note ?? '',
      csvMass: supplement ? '' : (part.unitMass ?? '').trim(),
      unitMass: amounts.mass,
      unitPrice: amounts.price,
      massSource: amounts.massSource,
      priceSource: amounts.priceSource,
      childSummary: amounts.childSummary,
      totalMass: amounts.mass !== undefined && quantity !== undefined ? amounts.mass * quantity : undefined,
      totalPrice: amounts.price !== undefined && quantity !== undefined ? amounts.price * quantity : undefined,
    };
  });
}

/**
 * 階層付きの行。40レベル部品の中身（50/60レベル）を、親の行のすぐ下に並べるために使う。
 * - `depth`: PLの明細そのものが 0、40レベル部品の中身が 1、さらにその中身が 2 …
 * - `path`: 開閉の状態と行の目印を覚えるための、親からたどった一意の名前
 * - `hasChildren`: 中身が登録されていて、開けるかどうか
 * - `balloonLabel`: 画面とExcelに出す風船。中身の行は「親の風船-中身の風船」（例: `7-1`）にする
 */
export type BomTreeRow = BomRow & { depth: number; path: string; hasChildren: boolean; balloonLabel: string };

/** 中身の行の風船。親の風船につなげて、どの40レベル部品の中身かを分かるようにする（`7` の中身の `1` → `7-1`）。 */
export const childBalloonLabel = (parent: string, child: string) => `${parent}-${child}`;

/**
 * 明細の行に、40レベル部品の中身を差し込んだ一覧を作る。`isOpen` が true を返した
 * 40レベル部品だけ中身を下に並べる（Excelのマルチレベル出力では、すべて開いて使う）。
 * 中身の並びは単体BOMと同じ（風船順・注記行を除く）。同じ40レベルが入れ子で現れても
 * 繰り返さないよう、たどってきた40レベルは開けないものとして扱う。
 */
export function expandBomRows(rows: BomRow[], facts: PartFact[], level40Parts: Level40Parts, unitBase: UnitBaseLookup | undefined,
  isOpen: (path: string) => boolean): BomTreeRow[] {
  const out: BomTreeRow[] = [];
  const walk = (items: BomRow[], depth: number, prefix: string, parentBalloon: string, seen: ReadonlySet<string>) => {
    items.forEach((row, index) => {
      const balloonLabel = depth ? childBalloonLabel(parentBalloon, row.part.balloon) : row.part.balloon;
      const path = `${prefix}/${index}:${partKey(row.part)}`;
      const key = level40Key(row.part);
      const children = isLevel40No(row.part.partNo) && !seen.has(key) ? level40Parts(row.part.partNo, row.part.version) : undefined;
      const parts = children ? sortPartsByBalloon(excludeNoteParts(children)) : [];
      out.push({ ...row, depth, path, hasChildren: parts.length > 0, balloonLabel });
      if (parts.length && isOpen(path)) walk(buildBomRows(parts, facts, level40Parts, unitBase), depth + 1, path, balloonLabel, new Set(seen).add(key));
    });
  };
  walk(rows, 0, '', '', new Set());
  return out;
}

/** 合計に入れるのはPLの明細そのもの（階層 0）だけ。中身は親の40レベル部品の値に含まれているため。 */
export const topLevelRows = <T extends BomRow>(rows: T[]): T[] =>
  rows.filter(row => !('depth' in row) || !(row as BomRow & { depth?: number }).depth);

/** 合計は、数として読めた行だけを足す。未入力の行を0として足すと合計を見誤るため。 */
export function sumBomRows(rows: BomRow[], pick: (row: BomRow) => number | undefined) {
  let total = 0, counted = 0;
  for (const row of rows) {
    const value = pick(row);
    if (value === undefined) continue;
    total += value;
    counted += 1;
  }
  return { total, counted };
}

/** 手で入力する2つの列。見出しに編集可・不可の切り替えを出すため、名前で引けるようにする。 */
export const MASS_COLUMN = '単品質量（kg）';
export const PRICE_COLUMN = '単価（円）';

/**
 * 掛け算・足し算で出る `2.4000000000000004` のような誤差を落とす。画面は桁を
 * 丸めて出すので見えないが、Excelには数値がそのまま入るため、ここで整える。
 * 10桁までは残すので、入力した精度（0.00828 など）は失わない。
 */
export const trimFloatNoise = (value: number): number => Math.round(value * 1e10) / 1e10;

/** その他ファイルの列名。マトリックスBOMのExcel出力でも同じ名前を使う。 */
export const OTHER_FILES_COLUMN = 'その他ファイル';

/** Excelに入れるときは、1件1行で「説明: リンク」にする（説明が無ければリンクだけ）。 */
export const partFilesText = (files: PartFile[] | undefined): string =>
  (files ?? []).map(file => file.label ? `${file.label}: ${file.url}` : file.url).join('\n');

/** 単体BOM・40レベル部品の中身で共通の列。表とExcel出力で同じ並びにする。 */
export const BOM_COLUMNS = ['風船', '品番', 'Ver.', '品名', '数量', '単位', '材質・メーカー', MASS_COLUMN, '合計質量（kg）', PRICE_COLUMN, '金額（円）', 'Shaiファイル', OTHER_FILES_COLUMN, UNITBASE_STATUS_COLUMN, UNITBASE_NOTE_COLUMN];

/**
 * 明細をExcelへ出します。単体BOMのタブと、40レベル部品の中身のポップアップで
 * **同じ表**を出すため、ここにまとめています。`sheetName` はシート名と
 * ファイル名の頭に使います（例: `40レベル部品_HJ02192040_v02.xlsx`）。
 * 数値はkgと円のまま入れ、画面のような丸めはしません。
 */
/** 未入力は空欄のまま、値があるときだけ誤差を落として数値で入れる。 */
export const excelAmount = (value: number | undefined) => value === undefined ? '' : trimFloatNoise(value);

/** Excelに入れる表（見出し・明細・合計）。列の並びは画面の表（`BOM_COLUMNS`）と同じにする。 */
export function bomExcelRows(rows: BomRow[]): (string | number)[][] {
  const massTotal = sumBomRows(rows, row => row.totalMass);
  const priceTotal = sumBomRows(rows, row => row.totalPrice);
  /* 合計は「材質・メーカー」の列に置く。左の列数が変わってもずれないよう、見出しから数える。 */
  const totalLabelIndex = BOM_COLUMNS.indexOf('材質・メーカー');
  return [
    BOM_COLUMNS,
    ...rows.map(row => [
      row.part.balloon, row.part.partNo, row.part.version, row.part.name, row.part.quantity, row.part.unit ?? '', row.part.material,
      excelAmount(row.unitMass), excelAmount(row.totalMass), excelAmount(row.unitPrice), excelAmount(row.totalPrice), row.shaiUrl, partFilesText(row.files), row.chemStatus, row.chemNote,
    ]),
    BOM_COLUMNS.map((column, index) =>
      index === totalLabelIndex ? '合計'
        : column === '合計質量（kg）' ? (massTotal.total ? trimFloatNoise(massTotal.total) : '')
        : column === '金額（円）' ? (priceTotal.total ? trimFloatNoise(priceTotal.total) : '')
        : ''),
  ];
}

export function exportBomExcel(list: PartsList, rows: BomRow[], sheetName: string) {
  const aoa = bomExcelRows(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(aoa), sheetName);
  /* ファイル名に使えない文字はWindowsに合わせて置き換える。 */
  const name = `${list.plNo}_v${normalizePlVersion(list.plVersion) || '-'}`.replace(/[\\/:*?"<>|]/g, '_');
  XLSX.writeFile(workbook, `${sheetName}_${name}.xlsx`);
}

/** マルチレベルのExcelで、先頭に足す階層の列。1がPLの明細そのもの、2がその40レベル部品の中身。 */
export const BOM_LEVEL_COLUMN = 'レベル';

/**
 * マルチレベルのExcelに入れる表。先頭に「レベル」の列を足し、40レベル部品の中身を
 * 親の行のすぐ下に並べる。合計はPLの明細そのもの（レベル1）だけで出す
 * （中身は親の40レベル部品の質量・単価にすでに含まれているため）。
 */
export function bomTreeExcelRows(rows: BomTreeRow[]): (string | number)[][] {
  const [header, ...rest] = bomExcelRows(rows);
  const total = bomExcelRows(topLevelRows(rows)).at(-1) ?? [];
  return [
    [BOM_LEVEL_COLUMN, ...header],
    /* 風船は画面と同じく、中身の行を「親の風船-中身の風船」にする。 */
    ...rest.slice(0, -1).map((line, index) => [rows[index].depth + 1, rows[index].balloonLabel, ...line.slice(1)]),
    ['', ...total],
  ];
}

/**
 * 単体BOMをマルチレベルでExcelへ出す。40レベル部品の中身はExcelの「グループ化」で
 * 折りたためるようにし、初めは開いた状態にする。
 */
export function exportBomTreeExcel(list: PartsList, rows: BomTreeRow[], sheetName: string) {
  const sheet = XLSX.utils.aoa_to_sheet(bomTreeExcelRows(rows));
  /* 見出しの1行ぶんずらして、明細の行にだけアウトラインの段を付ける。 */
  sheet['!rows'] = [{}, ...rows.map(row => row.depth ? { level: Math.min(row.depth, 7) } : {})];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  const name = `${list.plNo}_v${normalizePlVersion(list.plVersion) || '-'}`.replace(/[\\/:*?"<>|]/g, '_');
  XLSX.writeFile(workbook, `${sheetName}_${name}.xlsx`);
}

/** 明細の合計。値が入っていない部品は合計に入れないため、入っている件数も返す。 */
export type BomTotals = { parts: number; mass: { total: number; counted: number }; price: { total: number; counted: number } };

export const totalsOf = (rows: BomRow[]): BomTotals => ({
  parts: rows.length,
  mass: sumBomRows(rows, row => row.totalMass),
  price: sumBomRows(rows, row => row.totalPrice),
});

/**
 * PL比較の質量・金額。共通部品・それぞれのPLにだけある部品に分けて集計し、
 * 各PLの合計と差（比較PL − 基準PL）も出します。共通部品は両方の合計に同じだけ
 * 入るため、差は「比較PLのみ」と「基準PLのみ」の差と同じになります。
 */
export type ComparisonAmounts = {
  common: BomTotals; baseOnly: BomTotals; targetOnly: BomTotals;
  base: BomTotals; target: BomTotals;
  massDiff: number; priceDiff: number;
};

export function compareBomAmounts(common: BomRow[], baseOnly: BomRow[], targetOnly: BomRow[]): ComparisonAmounts {
  const base = totalsOf([...common, ...baseOnly]);
  const target = totalsOf([...common, ...targetOnly]);
  return {
    common: totalsOf(common), baseOnly: totalsOf(baseOnly), targetOnly: totalsOf(targetOnly),
    base, target,
    massDiff: target.mass.total - base.mass.total,
    priceDiff: target.price.total - base.price.total,
  };
}

/**
 * 単体BOMの列ごとの絞り込み条件。文字の列は部分一致（大文字・小文字、全角・半角を区別しない）、
 * chemSHERPA調査状況は一覧から選んだ値（複数可）のどれかと完全一致する行に絞ります（OR）。
 * 空の条件は絞り込みに使いません。
 */
export type BomFilter = { partNo: string; levels: string[]; name: string; material: string; chemStatuses: string[]; chemNote: string };

export const EMPTY_BOM_FILTER: BomFilter = { partNo: '', levels: [], name: '', material: '', chemStatuses: [], chemNote: '' };

/**
 * 品番の階層（9桁目）で絞るときの値。先頭がZの品番は購入品で、9桁目は階層を表さないため
 * 階層より先に「購入品」に分ける。階層が決まらない品番（補材・桁数の違う番号）は「その他」。
 */
export const PART_LEVEL_PURCHASED = 'purchased';
export const PART_LEVEL_OTHER = 'other';
const LEVEL_OPTIONS: { value: string; label: string }[] = [
  { value: '10', label: '10レベル' }, { value: '40', label: '40レベル' }, { value: '5060', label: '50/60レベル' },
  { value: PART_LEVEL_PURCHASED, label: '購入品（Z）' }, { value: PART_LEVEL_OTHER, label: 'その他' },
];
const levelValueOf = (row: BomRow) => isPurchasedPart(row.part.partNo) ? PART_LEVEL_PURCHASED : partLevelOf(row.part.partNo) || PART_LEVEL_OTHER;

/** 階層の選択肢と件数。並びは階層の順で固定し、選んだまま見失わないよう0件の階層も出す。 */
export function partLevelOptions(rows: BomRow[]): { value: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(levelValueOf(row), (counts.get(levelValueOf(row)) ?? 0) + 1);
  return LEVEL_OPTIONS.map(option => ({ ...option, count: counts.get(option.value) ?? 0 }));
}

/** chemSHERPA調査状況の「空欄（UnitBaseに一致なし・未記入）」を選ぶときの値。 */
export const CHEM_STATUS_BLANK = '\u0000blank';

/** 選択肢に出す名前。空欄を選ぶ値だけ「（空欄）」と出す。 */
export const chemStatusLabel = (value: string) => value === CHEM_STATUS_BLANK ? '（空欄）' : value;

const foldText = (value: string) => value.normalize('NFKC').toLowerCase();

/** 補材は品番で見分けられず、画面でもchemSHERPAの列を「—」にしているため空欄として扱う。 */
const chemStatusOf = (row: BomRow) => isSupplementPart(row.part.partNo) ? '' : row.chemStatus.trim();
const chemNoteOf = (row: BomRow) => isSupplementPart(row.part.partNo) ? '' : row.chemNote;

export function isBomFilterActive(filter: BomFilter): boolean {
  return filter.chemStatuses.length > 0 || filter.levels.length > 0 || [filter.partNo, filter.name, filter.material, filter.chemNote].some(value => value.trim() !== '');
}

export function filterBomRows(rows: BomRow[], filter: BomFilter): BomRow[] {
  if (!isBomFilterActive(filter)) return rows;
  const texts: [string, (row: BomRow) => string][] = [
    [filter.name, row => row.part.name],
    [filter.material, row => row.part.material],
    [filter.chemNote, chemNoteOf],
  ];
  const needles = texts.map(([value, get]) => [foldText(value.trim()), get] as const).filter(([needle]) => needle);
  const partNoMatch = partNoMatcher(filter.partNo);
  /* 空欄は選択肢では CHEM_STATUS_BLANK で表すため、行の値（空文字）に合わせて比べる。 */
  const statuses = new Set(filter.chemStatuses.map(value => value === CHEM_STATUS_BLANK ? '' : value));
  return rows.filter(row => {
    if (statuses.size && !statuses.has(chemStatusOf(row))) return false;
    if (partNoMatch && !partNoMatch(row.part.partNo)) return false;
    if (filter.levels.length && !filter.levels.includes(levelValueOf(row))) return false;
    return needles.every(([needle, get]) => foldText(get(row)).includes(needle));
  });
}

/** 品番の絞り込みで、ワイルドカードを使っているか。 */
export const isPartNoPattern = (value: string) => /[?？*＊]|\[[^\]]+\]/.test(value);

/**
 * 品番の絞り込み。ふつうは部分一致。`?`（任意の1文字）・`*`（任意の文字列）・`[456]`（どれか1文字、`[4-6]` も可）
 * を含むときは**先頭から**桁を合わせて比べる（末尾は以降に何があってもよい）。
 * 例: `?????????[456]` … 10桁目が4・5・6の品番。空なら undefined（絞り込まない）。
 */
export function partNoMatcher(value: string): ((partNo: string) => boolean) | undefined {
  const needle = foldText(value.trim());
  if (!needle) return undefined;
  if (!isPartNoPattern(needle)) return partNo => foldText(partNo).includes(needle);
  let source = '';
  for (let index = 0; index < needle.length; index++) {
    const char = needle[index];
    const close = char === '[' ? needle.indexOf(']', index + 1) : -1;
    if (close > index + 1) {
      /* 角かっこの中は文字と範囲（a-z）だけを通し、ほかの記号はそのまま文字として扱う。 */
      source += `[${needle.slice(index + 1, close).replace(/[\\^\]]/g, '\\$&')}]`;
      index = close;
    } else if (char === '?') source += '.';
    else if (char === '*') source += '.*';
    else source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  const pattern = new RegExp(`^${source}`);
  return partNo => pattern.test(foldText(partNo));
}

/** 絞り込みの選択肢に出すchemSHERPA調査状況と件数。多い順、同数は名前順。空欄は最後に1つだけ出す。 */
export function chemStatusOptions(rows: BomRow[]): { value: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const status = chemStatusOf(row);
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const blank = counts.get('') ?? 0;
  counts.delete('');
  const options = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'))
    .map(([value, count]) => ({ value, label: value, count }));
  if (blank) options.push({ value: CHEM_STATUS_BLANK, label: chemStatusLabel(CHEM_STATUS_BLANK), count: blank });
  return options;
}
