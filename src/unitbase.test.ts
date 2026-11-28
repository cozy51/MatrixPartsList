import { describe, expect, it } from 'vitest';
import { buildBomRows } from './bom';
import { decodeUnitBaseCsv, parseUnitBaseCsv, unitBaseValue } from './unitbase';
import type { Part } from './types';

const header = '"管理No.(技管側管理No.)","区分 (購入品 or 加工品)","品番 (子品番単位)","調査品番 (複数工程がある場合は、末尾に-1, -2, …で区別)","品名","chemSHERPA Ver.  (入手済chemSHERPAのバージョン)","chemSHERPA調査状況 (技管からサプライヤへの調査ステータス　""-""はchemSHERPA入手不可)","備考","更新日 (技管側 データ更新日)"';
const csv = [
  header,
  '"△2","購入品","Z909084800","Z909084800","RING","V2R1.03.0JP","完了","デクロランプラス資材調査品番：含有なし","2026/11/11"',
  '"11","購入品","Z905946800","Z905946800","MOTOR","","-","","2026/11/6"',
  '"4","加工品","HH0D125063","HH0D125063-2","PLATE","","依頼済","","2026/11/6"',
  '"4","加工品","HH0D125063","HH0D125063-1","PLATE","","備考参照","調査難航中","2026/11/6"',
  '"4","加工品","HH0X000060","HH0X000060","EMPTY","","","","2026/11/6"',
].join('\r\n');

describe('UnitBaseのCSV取り込み', () => {
  const data = parseUnitBaseCsv(csv, '化学物質管理V2_20261124-1624.csv');

  it('品番（子品番単位）ごとにchemSHERPA調査状況と備考を取り出す', () => {
    expect(data.rowCount).toBe(5);
    expect(unitBaseValue(data, 'Z909084800')).toEqual({ status: '完了', note: 'デクロランプラス資材調査品番：含有なし' });
    expect(unitBaseValue(data, 'z905946800 ')).toEqual({ status: '-', note: '' });
    expect(unitBaseValue(data, 'HH0X000060')).toBeUndefined();
    expect(unitBaseValue(data, 'NOTFOUND')).toBeUndefined();
  });

  it('工程が複数ある品番は、調査品番の枝番の順に1行ずつ並べる', () => {
    expect(unitBaseValue(data, 'HH0D125063')).toEqual({ status: '-1: 備考参照\n-2: 依頼済', note: '-1: 調査難航中' });
  });

  it('Shift_JISのCSVも読める', () => {
    const sjis = new Uint8Array([0x8a, 0xae, 0x97, 0xb9]); // 「完了」
    expect(decodeUnitBaseCsv(sjis.buffer)).toBe('完了');
    expect(decodeUnitBaseCsv(new TextEncoder().encode('﻿完了').buffer as ArrayBuffer)).toBe('完了');
  });

  it('見出しが違うCSVはエラーにする', () => {
    expect(() => parseUnitBaseCsv('風船,品番\n1,A', 'x.csv')).toThrow('chemSHERPA調査状況');
  });

  it('単体BOM・40レベルの明細に、品番が一致した値を出す（補材は出さない）', () => {
    const part = (partNo: string): Part => ({ balloon: '1', partNo, version: '', quantity: '1', unit: '', name: '', material: '', changeStatus: '', additionalInfo: '', unavailable: '', unitMass: '', specification: '' });
    const rows = buildBomRows([part('Z909084800'), part('+'), part('HJ00000060')], [], () => undefined, partNo => unitBaseValue(data, partNo));
    expect(rows.map(row => [row.chemStatus, row.chemNote])).toEqual([['完了', 'デクロランプラス資材調査品番：含有なし'], ['', ''], ['', '']]);
  });
});

describe('取り込むファイル', () => {
  it('Excelは先頭のシートをCSVにして読む', async () => {
    const XLSX = await import('xlsx');
    const { unitBaseTextFromFile, isExcelFileName } = await import('./unitbase');
    const sheet = XLSX.utils.aoa_to_sheet([['品番', 'chemSHERPA調査状況'], ['HJ00000060', '完了']]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'UnitBase');
    const buffer = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    expect(isExcelFileName('UnitBase.XLSX')).toBe(true);
    expect(isExcelFileName('UnitBase.csv')).toBe(false);
    expect(unitBaseTextFromFile('UnitBase.xlsx', buffer).split('\n')[1]).toBe('HJ00000060,完了');
  });
  it('CSVはそのまま文字列にする', async () => {
    const { unitBaseTextFromFile } = await import('./unitbase');
    expect(unitBaseTextFromFile('a.csv', new TextEncoder().encode('品番\nHJ1').buffer as ArrayBuffer)).toBe('品番\nHJ1');
  });
});
