import { describe, expect, it } from 'vitest';
import { BOM_COLUMNS, bomExcelRows, partFilesText, buildBomRows, compareBomAmounts, excelAmount, sumBomRows, totalsOf, trimFloatNoise, unitAmounts, type Level40Parts } from './bom';
import { emptyPartFact, upsertPartFact, type PartFact } from './drawings';
import type { Part } from './types';

const part = (partNo: string, quantity: string, unitMass = '', extra: Partial<Part> = {}): Part => ({
  balloon: '1', partNo, version: '-', quantity, unit: '', name: partNo, material: '', changeStatus: '',
  additionalInfo: '', unavailable: '', unitMass, specification: '', ...extra,
});
const fact = (partNo: string, mass: string, price: string): PartFact =>
  ({ ...emptyPartFact(partNo), mass, price, updatedAt: '2026-01-01T00:00:00.000Z' });

/* 40レベル（9桁目が 4）の中身。Ver.が一致する登録だけを返す。 */
const children: Record<string, Part[]> = {
  'HJ02192040': [part('HJ02192560', '2', '0.5'), part('HJ02192660', '1', '1.25'), part('+', '4')],
  'HJ02193040': [part('HJ02192040', '2'), part('HJ02193560', '1', '3')],
};
const level40Parts: Level40Parts = (partNo, version) => (version === '-' || version === '01' ? children[partNo.trim().toUpperCase()] : undefined);

describe('40レベル部品の質量・単価は中身の合計で決まる', () => {
  const facts = [fact('HJ02192560', '', '100'), fact('HJ02192660', '', '250'), fact('HJ02193560', '', '400')];

  it('中身（50/60レベル）を数量ぶん足した値を単品の値にする', () => {
    const amounts = unitAmounts(part('HJ02192040', '1'), facts, level40Parts);
    // 0.5kg × 2 + 1.25kg × 1、100円 × 2 + 250円 × 1
    expect(amounts).toMatchObject({ mass: 2.25, price: 450, massSource: 'children', priceSource: 'children' });
    // 注記に出すため、中身の部品数と値が入っている部品数を持つ（補材は品番で見分けられないため数えない）。
    expect(amounts.childSummary).toEqual({ parts: 3, massCounted: 2, priceCounted: 2 });
  });

  it('中身にさらに40レベルがあるときは、下まで合計する', () => {
    // （0.5×2 + 1.25）× 2 + 3 = 7.5kg、（100×2 + 250）× 2 + 400 = 1300円
    expect(unitAmounts(part('HJ02193040', '1'), facts, level40Parts)).toMatchObject({ mass: 7.5, price: 1300 });
  });

  it('中身が登録されていない40レベルは、自身の手入力・CSVの値を使わない', () => {
    const own = [fact('HJ09999040', '4.5', '900')];
    expect(unitAmounts(part('HJ09999040', '1', '8'), own, level40Parts)).toEqual({ mass: undefined, price: undefined, massSource: 'children', priceSource: 'children' });
    // Ver.が一致しない登録は結び付けない（40レベルはVer.ごとに中身が違うため）。
    expect(unitAmounts(part('HJ02192040', '1', '8', { version: '09' }), facts, level40Parts)).toEqual({ mass: undefined, price: undefined, massSource: 'children', priceSource: 'children' });
  });

  it('中身に値が1件もないときは、0kg・0円ではなく値なしにする', () => {
    const blank: Level40Parts = partNo => (partNo === 'HJ02192040' ? [part('HJ02192560', '2'), part('HJ02192660', '1')] : undefined);
    const amounts = unitAmounts(part('HJ02192040', '1'), [], blank);
    expect(amounts.mass).toBeUndefined();
    expect(amounts.price).toBeUndefined();
    expect(amounts.massSource).toBe('children');
    expect(amounts.childSummary).toEqual({ parts: 2, massCounted: 0, priceCounted: 0 });
  });

  it('同じ40レベルが入れ子で現れても数え続けない', () => {
    const loop: Level40Parts = partNo => (partNo === 'HJ02192040' ? [part('HJ02192040', '1', '2')] : undefined);
    /* 循環先に書かれた40レベル自身のCSV質量へフォールバックせず、値なしで止める。 */
    expect(unitAmounts(part('HJ02192040', '1'), [], loop)).toMatchObject({ mass: undefined, massSource: 'children' });
  });
});

describe('単体BOMの行', () => {
  it('手入力 → CSVの単品質量、の順に使い、数量を掛けて合計を出す', () => {
    const facts = upsertPartFact([], fact('HH110A5060', '0.44', '1,200'));
    const rows = buildBomRows([part('HH110A5060', '2', '0.4'), part('HH01002R61', '3', '0.12'), part('+', '4')], facts, () => undefined);
    expect(rows[0]).toMatchObject({ unitMass: 0.44, massSource: 'input', totalMass: 0.88, unitPrice: 1200, totalPrice: 2400 });
    expect(rows[1]).toMatchObject({ unitMass: 0.12, massSource: 'csv', totalMass: 0.36, unitPrice: undefined, totalPrice: undefined });
    // 補材（`+`）は品番で見分けられないため、質量・価格を持たない。
    expect(rows[2]).toMatchObject({ unitMass: undefined, unitPrice: undefined, massSource: 'none' });
  });

  it('合計は、数として読めた行だけを足して件数を返す', () => {
    const rows = buildBomRows([part('HH110A5060', '2', '0.4'), part('HH01002R61', '1'), part('+', '4')], [], () => undefined);
    expect(sumBomRows(rows, row => row.totalMass)).toEqual({ total: 0.8, counted: 1 });
    expect(sumBomRows(rows, row => row.totalPrice)).toEqual({ total: 0, counted: 0 });
  });
});

describe('PL比較の質量・金額', () => {
  const facts: PartFact[] = [fact('A10', '1.5', '100'), fact('B20', '0.5', '40'), fact('C30', '2', '300')];
  const rows = (parts: Part[]) => buildBomRows(parts, facts, () => undefined);
  /* 共通: A10×2（3kg・200円）／基準のみ: B20×1（0.5kg・40円）／比較のみ: C30×1（2kg・300円） */
  const common = rows([part('A10', '2')]);
  const baseOnly = rows([part('B20', '1')]);
  const targetOnly = rows([part('C30', '1')]);

  it('まとまりごとに合計する', () => {
    expect(totalsOf(common)).toEqual({ parts: 1, mass: { total: 3, counted: 1 }, price: { total: 200, counted: 1 } });
    expect(totalsOf(baseOnly)).toEqual({ parts: 1, mass: { total: 0.5, counted: 1 }, price: { total: 40, counted: 1 } });
  });

  it('各PLの合計は「共通 ＋ そのPLだけの部品」になる', () => {
    const amounts = compareBomAmounts(common, baseOnly, targetOnly);
    expect(amounts.base.mass.total).toBe(3.5);
    expect(amounts.base.price.total).toBe(240);
    expect(amounts.target.mass.total).toBe(5);
    expect(amounts.target.price.total).toBe(500);
    expect(amounts.base.parts).toBe(2);
    expect(amounts.target.parts).toBe(2);
  });

  it('差は「比較PL − 基準PL」で、共通部品は打ち消し合う', () => {
    const amounts = compareBomAmounts(common, baseOnly, targetOnly);
    expect(amounts.massDiff).toBeCloseTo(1.5, 10);
    expect(amounts.priceDiff).toBe(260);
    // 共通部品が増えても差は変わらない。
    const withMoreCommon = compareBomAmounts(rows([part('A10', '2'), part('C30', '5')]), baseOnly, targetOnly);
    expect(withMoreCommon.massDiff).toBeCloseTo(1.5, 10);
    expect(withMoreCommon.priceDiff).toBe(260);
  });

  it('値が入っていない部品は合計に入れず、入っている件数を残す', () => {
    const withBlank = rows([part('A10', '2'), part('ZZ99', '1')]);
    const amounts = compareBomAmounts(withBlank, [], []);
    expect(amounts.base.parts).toBe(2);
    expect(amounts.base.mass).toEqual({ total: 3, counted: 1 });
    expect(amounts.base.price).toEqual({ total: 200, counted: 1 });
  });

  it('部品が1つもないまとまりは 0 件として扱う', () => {
    expect(totalsOf([])).toEqual({ parts: 0, mass: { total: 0, counted: 0 }, price: { total: 0, counted: 0 } });
  });
});

describe('Excelに入れる数値', () => {
  it('掛け算・足し算で出る誤差を落とす', () => {
    expect(0.8 * 3).not.toBe(2.4);              // 2.4000000000000004
    expect(trimFloatNoise(0.8 * 3)).toBe(2.4);
    expect(trimFloatNoise(5.9 - 5.5)).toBe(0.4);
  });

  it('入力した精度は失わない', () => {
    expect(trimFloatNoise(0.00828)).toBe(0.00828);
    expect(trimFloatNoise(1234567.89)).toBe(1234567.89);
  });

  it('未入力は空欄のままにする', () => {
    expect(excelAmount(undefined)).toBe('');
    expect(excelAmount(0)).toBe(0);
    expect(excelAmount(0.8 * 3)).toBe(2.4);
  });
});

describe('Excelの表（単体BOM・40レベル部品の中身）', () => {
  /* 数量は個数のことが多く単位は空欄。ケーブルなど長さで数える部品だけ mm などが入る。 */
  const rows = buildBomRows([part('Z067872810', '60', '0.01', { unit: 'mm' }), part('Z076580700', '1')], [], () => undefined);

  it('単位の列を数量の右隣に置き、見出しと明細・合計の列数をそろえる', () => {
    const [header, cable, ...rest] = bomExcelRows(rows);
    expect(header[BOM_COLUMNS.indexOf('数量') + 1]).toBe('単位');
    expect(cable[BOM_COLUMNS.indexOf('単位')]).toBe('mm');
    expect(cable[BOM_COLUMNS.indexOf('材質・メーカー')]).toBe('');
    expect(rest.every(row => row.length === header.length)).toBe(true);
  });

  it('合計は材質・メーカーの列に置き、合計質量・金額の列に値を入れる', () => {
    const total = bomExcelRows(rows).at(-1) ?? [];
    expect(total[BOM_COLUMNS.indexOf('材質・メーカー')]).toBe('合計');
    expect(total[BOM_COLUMNS.indexOf('合計質量（kg）')]).toBe(0.6);
    expect(total[BOM_COLUMNS.indexOf('金額（円）')]).toBe('');
  });
  it('その他ファイルはExcelで1件1行の「説明: リンク」にする', () => {
    expect(partFilesText([{ id: 'a', label: '試験成績書', url: 'https://example.com/a' }, { id: 'b', label: '', url: 'https://example.com/b' }]))
      .toBe('試験成績書: https://example.com/a\nhttps://example.com/b');
    expect(partFilesText(undefined)).toBe('');
  });
});
