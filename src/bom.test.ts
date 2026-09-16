import { describe, expect, it } from 'vitest';
import { buildBomRows, sumBomRows, unitAmounts, type Level40Parts } from './bom';
import { emptyPartFact, upsertPartFact, type PartFact } from './drawings';
import type { Part } from './types';

const part = (partNo: string, quantity: string, unitMass = '', extra: Partial<Part> = {}): Part => ({
  balloon: '1', partNo, version: '-', quantity, name: partNo, material: '', changeStatus: '',
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

  it('中身が登録されていない40レベルは、手入力・CSVの値を使う', () => {
    const own = [fact('HJ09999040', '4.5', '900')];
    expect(unitAmounts(part('HJ09999040', '1'), own, level40Parts)).toMatchObject({ mass: 4.5, price: 900, massSource: 'input', priceSource: 'input' });
    // Ver.が一致しない登録は結び付けない（40レベルはVer.ごとに中身が違うため）。
    expect(unitAmounts(part('HJ02192040', '1', '', { version: '09' }), facts, level40Parts)).toMatchObject({ massSource: 'none' });
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
    expect(unitAmounts(part('HJ02192040', '1'), [], loop)).toMatchObject({ mass: 2, massSource: 'children' });
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
