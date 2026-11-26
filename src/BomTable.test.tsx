import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import BomTable, { highlightChemNote, shortChemNote, type Level40Access } from './BomTable';
import { buildBomRows, type Level40Parts } from './bom';
import type { Part } from './types';

const level40Part: Part = {
  balloon: '1', partNo: 'HJ02192040', version: '01', quantity: '1', unit: '', name: '40レベル部品',
  material: '', changeStatus: '', additionalInfo: '', unavailable: '', unitMass: '', specification: '',
};
const child: Part = { ...level40Part, partNo: 'HJ02192560', name: '中身', unitMass: '' };
const access: Level40Access = { find: () => undefined, otherVersions: () => '', open: () => undefined };

const render = (level40Parts: Level40Parts) => renderToStaticMarkup(<BomTable
  rows={buildBomRows([level40Part], [], level40Parts)} facts={[]} onFactsChange={() => undefined}
  renderBadges={() => null} level40={access} totalLabel="合計"
/>);

describe('40レベル部品の質量・価格表示', () => {
  it('40リスト自体が未登録なら、中身の合計という注記を出さず入力不可にする', () => {
    const html = render(() => undefined);
    expect(html).not.toContain('中身の合計');
    expect(html).not.toContain('solo-amount');
    expect(html).toContain('リストが未登録のため、この欄には入力できません');
  });

  it('40リストは登録済みだが中身の値が未登録なら、赤字の未登録表示を出す', () => {
    const html = render(() => [child]);
    expect(html).toContain('bom-derived is-unregistered');
    expect(html).toContain('中身の合計（未登録）');
  });
});

describe('備考(import)の表示', () => {
  it('「資材調査品番」を省く', () => {
    expect(shortChemNote('デクロランプラス資材調査品番：含有なし')).toBe('デクロランプラス：含有なし');
    expect(shortChemNote('サプライヤ回答待ち')).toBe('サプライヤ回答待ち');
  });

  it('「含有なし」を青、「含有あり」を赤で強調する', () => {
    const html = renderToStaticMarkup(<>{highlightChemNote('デクロランプラス：含有なし\nPFAS：含有あり')}</>);
    expect(html).toContain('<mark class="chem-content is-absent">含有なし</mark>');
    expect(html).toContain('<mark class="chem-content is-present">含有あり</mark>');
    expect(highlightChemNote('サプライヤ回答待ち')).toBe('サプライヤ回答待ち');
  });
});
