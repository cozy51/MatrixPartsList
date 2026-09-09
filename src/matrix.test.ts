import { describe, expect, it } from 'vitest';
import { buildBalloonGroups, buildCompatibleGroups, buildListCompatibleIndex, buildQuantityConflicts, buildVersionConflicts, partKeyWithoutQuantity, calculatePlSimilarities, compatibleBaseNo, compatibleDigitLabel, collectPartsInSourceOrder, comparePlParts, countPartOccurrences, filterPartsByBalloon, filterSupplementParts, isCustomerSpecialPl, isPurchasedPart, isStandardPl, plKindLabel, setListsVisibilityByMode, sortPartsByBalloon, sortPartsLists } from './matrix';
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
  it('identifies HH3 and HJ3 prefixes as customer-specific PLs', () => {
    expect(isCustomerSpecialPl('HH3310CB10')).toBe(true);
    expect(isCustomerSpecialPl('hh3300dg10')).toBe(true);
    expect(isCustomerSpecialPl('HJ33101010')).toBe(true);
    expect(isCustomerSpecialPl(' hj3101k810 ')).toBe(true);
    expect(isCustomerSpecialPl('HH13182010')).toBe(false);
    expect(isCustomerSpecialPl('HJ02100010')).toBe(false);
  });
  it('標準PLはSTD、客先特殊PLはCST、どちらでもなければ印を出さない', () => {
    expect(plKindLabel('HH13182010')).toBe('STD');
    expect(plKindLabel('HJ09301010')).toBe('STD');
    expect(plKindLabel('HH3310CB10')).toBe('CST');
    expect(plKindLabel('HJ33101010')).toBe('CST');
    expect(plKindLabel('HD1DG01010')).toBe('');
    expect(plKindLabel('')).toBe('');
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
    // 購入品は対象外。
    expect(compatibleBaseNo('Z076048100')).toBe('');
    // 11桁の品番は11桁目が末尾1桁。10桁目までが基本番号になる。
    expect(compatibleBaseNo('HJ0N517A501')).toBe('HJ0N517A50');
    expect(compatibleBaseNo('hj0n517a502')).toBe('HJ0N517A50');
    // 11桁でも、9文字目が1のPLは対象外。
    expect(compatibleBaseNo('HH110040100')).toBe('');
    // 12桁以上は対象外。
    expect(compatibleBaseNo('HD1AG0064204')).toBe('');
    expect(compatibleDigitLabel('HJ06158060')).toBe('10桁目');
    expect(compatibleDigitLabel('HD1DG01444')).toBe('10桁目');
  });

  it('機種CD HM0 は、10桁目・11桁目のどちらが違っても互換として扱う', () => {
    // 先頭9桁が基本番号になる。
    expect(compatibleBaseNo('HM0M69404D0')).toBe('HM0M69404');
    expect(compatibleBaseNo('HM0N517A501')).toBe('HM0N517A5');
    expect(compatibleDigitLabel('HM0M69404D0')).toBe('10・11桁目');
    // 10桁の品番は、これまでどおり10桁目だけの違い。
    expect(compatibleBaseNo('HM0M6940410')).toBe('HM0M69404');
    expect(compatibleDigitLabel('HM0M694041')).toBe('10桁目');
    // 他の機種CDの11桁の品番は、11桁目だけの違いのまま。
    expect(compatibleBaseNo('HJ0N517A501')).toBe('HJ0N517A50');
    expect(compatibleDigitLabel('HJ0N517A501')).toBe('11桁目');
  });

  it('機種CD HM0 は、10桁目が違う品番も同じ組にまとめる', () => {
    const groups = buildCompatibleGroups([
      part('50', 'HM0M69404D0'), part('50', 'HM0M69404E0'),
      part('50', 'HM0M69404F0'), part('50', 'HM0M69404G0'),
      part('8', 'HM0N517A501'), part('8', 'HM0N517A502'), part('8', 'HM0N517A510'),
    ]);
    expect(groups.get('HM0M69404')).toEqual(['HM0M69404D0', 'HM0M69404E0', 'HM0M69404F0', 'HM0M69404G0']);
    // 11桁目だけが違うものも、10桁目が違うものも同じ組になる。
    expect(groups.get('HM0N517A5')).toEqual(['HM0N517A501', 'HM0N517A502', 'HM0N517A510']);
  });

  it('11桁の品番は、11桁目だけが違うものを互換としてまとめる', () => {
    const groups = buildCompatibleGroups([
      part('8', 'HJ0N517A501'), part('8', 'HJ0N517A502'), part('8', 'HJ0N517A510'),
      part('8', 'HJ0N500A501'), part('8', 'HJ0N500B501'),
    ]);
    // 11桁目だけが違う HJ0N517A501 と HJ0N517A502 が1組。
    expect(groups.get('HJ0N517A50')).toEqual(['HJ0N517A501', 'HJ0N517A502']);
    // 10桁目が違う HJ0N517A510 は別の基本番号。1件だけなので組にならない。
    expect(groups.get('HJ0N517A51')).toBeUndefined();
    // 8文字目が違う品番どうしも別扱い。
    expect(groups.get('HJ0N500A50')).toBeUndefined();
    expect(groups.size).toBe(1);
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

describe('同じ品番でVer.だけが違う行', () => {
  const withVersion = (balloon: string, partNo: string, version: string) => ({ ...part(balloon, partNo), version });

  it('Ver.が2通り以上ある品番だけをまとめ、Ver.は昇順で返す', () => {
    const conflicts = buildVersionConflicts([
      withVersion('31', 'HD1DE02841', '2'),
      withVersion('31', 'HD1DE02841', '1'),
      withVersion('31', 'HD1DE02941', '2'),
    ]);
    expect(conflicts.size).toBe(1);
    expect(conflicts.get('HD1DE02841')).toEqual(['1', '2']);
    // Ver.が1通りだけの品番は対象外。
    expect(conflicts.get('HD1DE02941')).toBeUndefined();
  });

  it('Ver.なし（-）と数字のVer.が混ざっている場合も違いとして扱う', () => {
    const conflicts = buildVersionConflicts([withVersion('30', 'HH13016060', '-'), withVersion('30', 'HH13016060', '1')]);
    expect(conflicts.get('HH13016060')).toEqual(['-', '1']);
  });

  it('風船番号が違っても、同じ品番ならVer.の違いとして扱う', () => {
    // 同じ品番が別の風船で使われていても、Ver.の取り違えは同じように起こる。
    const conflicts = buildVersionConflicts([withVersion('31', 'HD1DE02841', '1'), withVersion('32', 'HD1DE02841', '2')]);
    expect(conflicts.get('HD1DE02841')).toEqual(['1', '2']);
  });

  it('補材（+）と表記ゆれを除く', () => {
    const conflicts = buildVersionConflicts([
      { ...part('17', '+'), version: '1' },
      { ...part('17', '+'), version: '2' },
      withVersion('20', ' hd1de02841 ', '1'),
      withVersion('20', 'HD1DE02841', '2'),
    ]);
    // 補材は品番を持たないため対象外。前後の空白と大文字小文字は同じ品番として扱う。
    expect(conflicts.size).toBe(1);
    expect(conflicts.get('HD1DE02841')).toEqual(['1', '2']);
  });
});
