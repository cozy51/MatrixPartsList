import { describe, expect, it } from 'vitest';
import { buildBalloonGroups, buildCompatibleGroups, buildListCompatibleIndex, buildQuantityConflicts, partKeyWithoutQuantity, calculatePlSimilarities, compatibleBaseNo, collectPartsInSourceOrder, comparePlParts, countPartOccurrences, filterPartsByBalloon, filterSupplementParts, isPurchasedPart, isStandardPl, setListsVisibilityByMode, sortPartsByBalloon, sortPartsLists } from './matrix';
import type { Part, PartsList } from './types';

const part = (balloon: string, partNo: string): Part => ({
  balloon,
  partNo,
  version: '-',
  quantity: '1',
  name: partNo,
  material: '',
  changeStatus: '',
  additionalInfo: '',
  unavailable: '',
  unitMass: '',
  specification: '',
});

const list = (plNo: string): PartsList => ({
  id: plNo,
  fileName: `${plNo}.csv`,
  plNo,
  plName: '',
  plVersion: '',
  machineId: 'SRC350',
  modeId: '01',
  parts: [],
  visible: true,
  importedAt: '',
});

describe('reference workbook ordering', () => {
  it('identifies HH1 and HJ0 prefixes as standard PLs', () => {
    expect(isStandardPl('HH11000010')).toBe(true);
    expect(isStandardPl('hh110A0010')).toBe(true);
    expect(isStandardPl('HJ02100010')).toBe(true);
    expect(isStandardPl(' hj09301010 ')).toBe(true);
    expect(isStandardPl('HH3101K810')).toBe(false);
    expect(isStandardPl('HJ12100010')).toBe(false);
  });
  it('bulk-selects only lists in the active mode', () => {
    const first = list('A'), second = list('B');
    first.modeId = '01'; second.modeId = '02'; first.visible = false; second.visible = false;
    const changed = setListsVisibilityByMode([first, second], '01', true);
    expect(changed.map(item => item.visible)).toEqual([true, false]);
  });
  it('filters rows by the selected balloon', () => {
    const parts = [part('1', 'a'), part('2', 'b'), part('2', 'c')];
    expect(filterPartsByBalloon(parts, '2').map(item => item.partNo)).toEqual(['b', 'c']);
    expect(filterPartsByBalloon(parts, 'all')).toBe(parts);
  });
  it('calculates and sorts Jaccard similarity against a selected PL', () => {
    const base = list('BASE'), close = list('CLOSE'), far = list('FAR');
    base.parts = [part('1', 'a'), part('2', 'b')];
    close.parts = [part('1', 'a'), part('2', 'b'), part('3', 'c')];
    far.parts = [part('9', 'z')];
    const results = calculatePlSimilarities([far, close, base], base.id);
    expect(results.map(result => result.list.id)).toEqual([base.id, close.id, far.id]);
    expect(results[1]).toMatchObject({ common: 2, union: 3, score: 2 / 3 });
  });
  it('sorts numeric balloons and keeps first appearance within a balloon', () => {
    const sorted = sortPartsByBalloon([
      part('4', 'four'),
      part('3', 'three-a'),
      part('11', 'eleven'),
      part('1', 'one'),
      part('3', 'three-b'),
      part('C', 'note'),
    ]);
    expect(sorted.map(({ partNo }) => partNo)).toEqual([
      'one',
      'three-a',
      'three-b',
      'four',
      'eleven',
      'note',
    ]);
  });

  it('marks balloon group boundaries for row styling', () => {
    const parts = [part('1', 'a'), part('1', 'b'), part('2', 'c'), part('3', 'd')];
    expect(buildBalloonGroups(parts)).toEqual([
      { index: 0, start: true },
      { index: 0, start: false },
      { index: 1, start: true },
      { index: 2, start: true },
    ]);
  });

  it('風船番号ごとに補材（+）を最後へ置く', () => {
    const first = list('HH110A0010');
    first.parts = [part('2', 'ring'), part('1', '+')];
    const second = list('HH11000010');
    second.parts = [part('1', 'block'), part('2', '+')];
    expect(collectPartsInSourceOrder([first, second]).map(({ balloon, partNo }) => `${balloon}:${partNo}`)).toEqual([
      '1:block', '1:+', '2:ring', '2:+',
    ]);
  });

  it('同じ風船番号の中は品番の昇順に並べ、補材は最後にする', () => {
    const first = list('HH110A0010');
    first.parts = [part('26', 'HJ02172061'), part('26', '+'), part('25', 'Z080670700')];
    const second = list('HH11000010');
    // 別のPLで先に現れた品番でも、同じ風船番号の中では品番の昇順に並べる。
    second.parts = [part('26', 'HJ02128060'), part('26', '+')];
    expect(collectPartsInSourceOrder([first, second]).map(({ balloon, partNo }) => `${balloon}:${partNo}`)).toEqual([
      '25:Z080670700', '26:HJ02128060', '26:HJ02172061', '26:+',
    ]);
  });

  it('sorts PL columns naturally, independent of import order', () => {
    expect(sortPartsLists([list('HH3101K810'), list('HH110A0010'), list('HH11002010'), list('HH11000010'), list('HH11001010')]).map(x => x.plNo)).toEqual([
      'HH11000010',
      'HH11001010',
      'HH11002010',
      'HH110A0010',
      'HH3101K810',
    ]);
  });

  it('counts duplicate detail rows so exceptional PL counts remain visible', () => {
    const target = part('1', 'bolt');
    const partsList = list('HH11000010');
    partsList.parts = [target, { ...target }, part('2', 'nut')];
    expect(countPartOccurrences(partsList, target)).toBe(2);
    expect(countPartOccurrences(partsList, part('2', 'nut'))).toBe(1);
    expect(countPartOccurrences(partsList, part('3', 'washer'))).toBe(0);
  });

  it('can hide every supplement row in one operation', () => {
    const parts = [part('1', '+'), part('1', 'bolt'), part('2', '+')];
    expect(filterSupplementParts(parts, false).map(item => item.partNo)).toEqual(['bolt']);
    expect(filterSupplementParts(parts, true)).toEqual(parts);
  });

  it('returns common and PL-specific parts for similarity details', () => {
    const base = list('HH11000010');
    const target = list('HH11001010');
    base.parts = [part('1', 'common'), part('2', 'base-only')];
    target.parts = [part('1', 'common'), part('3', 'target-only')];
    const detail = comparePlParts(base, target);
    expect(detail.common.map(item => item.partNo)).toEqual(['common']);
    expect(detail.baseOnly.map(item => item.partNo)).toEqual(['base-only']);
    expect(detail.targetOnly.map(item => item.partNo)).toEqual(['target-only']);
  });
});

describe('isPurchasedPart', () => {
  it('Zで始まる品番を購入品として扱う', () => {
    expect(isPurchasedPart('Z069714560')).toBe(true);
    expect(isPurchasedPart('z078609500')).toBe(true);
    expect(isPurchasedPart(' Z074963100 ')).toBe(true);
    expect(isPurchasedPart('HH110A5060')).toBe(false);
    expect(isPurchasedPart('+')).toBe(false);
    expect(isPurchasedPart('')).toBe(false);
  });
});

describe('部品図の互換（10桁目の違い）', () => {
  it('部品図だけ、先頭9桁を基本番号として扱う', () => {
    expect(compatibleBaseNo('HJ06158060')).toBe('HJ0615806');
    expect(compatibleBaseNo('hj06158061')).toBe('HJ0615806');
    // 9文字目が5の部品図も対象。
    expect(compatibleBaseNo('HJ06158550')).toBe('HJ0615855');
    // 9文字目が4の組立図も、部品図と同じく10桁目の違いで互換。
    expect(compatibleBaseNo('HD1DG01444')).toBe('HD1DG0144');
    expect(compatibleBaseNo('HD1DG01445')).toBe('HD1DG0144');
    expect(compatibleBaseNo('HH110A0040')).toBe('HH110A004');
    // PL（9文字目が1）は10桁目が違えば別のユニットなので対象外。
    expect(compatibleBaseNo('HH11004010')).toBe('');
    // 購入品や11桁の図番も対象外。
    expect(compatibleBaseNo('Z076048100')).toBe('');
    expect(compatibleBaseNo('HJ061580601')).toBe('');
  });

  it('10桁目だけが違う品番が2つ以上あるときにまとめる', () => {
    const groups = buildCompatibleGroups([
      part('102', 'HJ06158061'), part('102', 'HJ06158060'),
      part('105', 'HJ06159060'), part('80', 'Z076048100'), part('101', '+'),
    ]);
    expect([...groups.keys()]).toEqual(['HJ0615806']);
    // 組立図（9文字目が4）も同じようにまとめる。
    expect(buildCompatibleGroups([part('18', 'HD1DG01444'), part('18', 'HD1DG01445')]).get('HD1DG0144')).toEqual(['HD1DG01444', 'HD1DG01445']);
    // 品番は昇順にそろえて返す。
    expect(groups.get('HJ0615806')).toEqual(['HJ06158060', 'HJ06158061']);
  });

  it('PLごとに、そのPLが持つ互換品を引ける', () => {
    const target = list('HJ06103010');
    target.parts = [part('102', 'HJ06158061'), part('C', 'HJ06158069'), part('105', 'HJ06159060')];
    const index = buildListCompatibleIndex(target);
    // 注記行（風船C）は数えない。
    expect(index.get('HJ0615806')).toEqual(['HJ06158061']);
    expect(index.get('HJ0615906')).toEqual(['HJ06159060']);
  });
});

describe('同じ部品で個数だけが違う行', () => {
  const withQuantity = (balloon: string, partNo: string, quantity: string, name = partNo) => ({ ...part(balloon, partNo), quantity, name });

  it('個数が2通り以上ある部品だけをまとめ、個数は昇順で返す', () => {
    const conflicts = buildQuantityConflicts([
      withQuantity('17', 'HH13026060', '2'),
      withQuantity('17', 'HH13026060', '1'),
      withQuantity('17', 'HH13008060', '3'),
      // 補材（+）は品名で現物を区別しているため、数量が違っても対象外。
      withQuantity('17', '+', '3', 'HCZr M4X8'),
      withQuantity('17', '+', '1', 'HCZr M4X8'),
      withQuantity('16', '+', '6', 'HC M3X6'),
    ]);
    expect(conflicts.size).toBe(1);
    expect(conflicts.get(partKeyWithoutQuantity(withQuantity('17', 'HH13026060', '1')))).toEqual(['1', '2']);
    expect(conflicts.get(partKeyWithoutQuantity(withQuantity('17', '+', '1', 'HCZr M4X8')))).toBeUndefined();
    // 個数が1通りだけの部品は対象外。
    expect(conflicts.get(partKeyWithoutQuantity(withQuantity('17', 'HH13008060', '3')))).toBeUndefined();
  });

  it('風船番号が違えば別の部品として扱う', () => {
    const conflicts = buildQuantityConflicts([withQuantity('17', 'HH13026060', '1'), withQuantity('18', 'HH13026060', '2')]);
    expect(conflicts.size).toBe(0);
  });
});
