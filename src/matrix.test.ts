import { describe, expect, it } from 'vitest';
import { buildBalloonGroups, calculatePlSimilarities, collectPartsInSourceOrder, comparePlParts, countPartOccurrences, filterPartsByBalloon, filterSupplementParts, isPurchasedPart, isStandardPl, setListsVisibilityByMode, sortPartsByBalloon, sortPartsLists } from './matrix';
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
  it('identifies HH1 prefixes as standard PLs', () => {
    expect(isStandardPl('HH11000010')).toBe(true);
    expect(isStandardPl('hh110A0010')).toBe(true);
    expect(isStandardPl('HH3101K810')).toBe(false);
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

  it('keeps supplements separate by balloon and preserves source-list order', () => {
    const first = list('HH110A0010');
    first.parts = [part('2', 'ring'), part('1', '+')];
    const second = list('HH11000010');
    second.parts = [part('1', 'block'), part('2', '+')];
    expect(collectPartsInSourceOrder([first, second]).map(({ balloon, partNo }) => `${balloon}:${partNo}`)).toEqual([
      '1:+', '1:block', '2:ring', '2:+',
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
