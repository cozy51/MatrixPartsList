import * as XLSX from 'xlsx';
import { normalizePlVersion, versionMatchKey } from './csv';
import { parseAmount, partFactFor, type PartFact } from './drawings';
import { isLevel40No, levelNoKey } from './levels';
import { excludeNoteParts, isSupplementPart } from './matrix';
import type { Part, PartsList } from './types';

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
  const children = isLevel40No(part.partNo) && !seen.has(key) ? level40Parts(part.partNo, part.version) : undefined;
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
export function buildBomRows(parts: Part[], facts: PartFact[], level40Parts: Level40Parts): BomRow[] {
  return parts.map(part => {
    const supplement = isSupplementPart(part.partNo);
    const fact = supplement ? undefined : partFactFor(facts, part.partNo);
    const amounts = unitAmounts(part, facts, level40Parts);
    const quantity = parseAmount(part.quantity);
    return {
      part,
      massInput: fact?.mass ?? '',
      priceInput: fact?.price ?? '',
      shaiUrl: fact?.shaiUrl ?? '',
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

/** 単体BOM・40レベル部品の中身で共通の列。表とExcel出力で同じ並びにする。 */
export const BOM_COLUMNS = ['風船', '品番', 'Ver.', '品名', '数量', '材質・メーカー', MASS_COLUMN, '合計質量（kg）', PRICE_COLUMN, '金額（円）', 'Shaiファイル'];

/**
 * 明細をExcelへ出します。単体BOMのタブと、40レベル部品の中身のポップアップで
 * **同じ表**を出すため、ここにまとめています。`sheetName` はシート名と
 * ファイル名の頭に使います（例: `40レベル部品_HJ02192040_v02.xlsx`）。
 * 数値はkgと円のまま入れ、画面のような丸めはしません。
 */
/** 未入力は空欄のまま、値があるときだけ誤差を落として数値で入れる。 */
export const excelAmount = (value: number | undefined) => value === undefined ? '' : trimFloatNoise(value);

export function exportBomExcel(list: PartsList, rows: BomRow[], sheetName: string) {
  const massTotal = sumBomRows(rows, row => row.totalMass);
  const priceTotal = sumBomRows(rows, row => row.totalPrice);
  const aoa = [
    BOM_COLUMNS,
    ...rows.map(row => [
      row.part.balloon, row.part.partNo, row.part.version, row.part.name, row.part.quantity, row.part.material,
      excelAmount(row.unitMass), excelAmount(row.totalMass), excelAmount(row.unitPrice), excelAmount(row.totalPrice), row.shaiUrl,
    ]),
    ['', '', '', '', '', '合計', '', massTotal.total ? trimFloatNoise(massTotal.total) : '', '', priceTotal.total ? trimFloatNoise(priceTotal.total) : '', ''],
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(aoa), sheetName);
  /* ファイル名に使えない文字はWindowsに合わせて置き換える。 */
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
