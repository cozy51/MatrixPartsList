import { describe, expect, it } from 'vitest';
import { backupFileName, buildBackup, parseBackup } from './db';

describe('JSONバックアップのファイル名', () => {
  it('取得した日時を `YYYY-MM-DD_hhmm` で付ける', () => {
    // そのパソコンの時刻で名前を付ける（日付の見た目が時差でずれないようにするため）。
    expect(backupFileName(new Date(2026, 8, 17, 5, 33))).toBe('MatrixPartsList-backup_2026-09-17_0533.json');
    expect(backupFileName(new Date(2026, 11, 1, 23, 9))).toBe('MatrixPartsList-backup_2026-12-01_2309.json');
  });

  it('月・日・時・分は必ず2桁にする', () => {
    expect(backupFileName(new Date(2026, 0, 2, 0, 0))).toBe('MatrixPartsList-backup_2026-01-02_0000.json');
  });
});

const list = {
  id: 'a1', fileName: 'HH1234567.xlsx', plNo: 'HH1234567', plName: '搬送ユニット', plVersion: '01',
  machineId: 'HU300', modeId: '01', visible: true, importedAt: '2026-09-17T08:20:00.000Z',
  parts: [{ balloon: '67', partNo: 'HH1234567-5', version: 'A', quantity: '2', name: 'ブラケット', material: 'SPCC', changeStatus: '', additionalInfo: '', unavailable: '', unitMass: '', specification: '' }],
};
const data = { revision: 5, updatedAt: '2026-09-17T08:20:00.000Z', lists: [list] };
const drawings = {
  revision: 3, updatedAt: '2026-09-17T08:16:00.000Z',
  drawings: [{ id: 'd1', drawingNo: 'HH1234567', docNo: '1234567', fileType: 'PDF', fileName: 'HH1234567.pdf', url: 'https://example.com/a.pdf', partNos: ['HH1234567'], note: '', updatedAt: '2026-09-17T08:16:00.000Z' }],
  cadIds: [{ partNo: 'HH1234567', cadId: 'CAD-1', updatedAt: '2026-09-17T08:16:00.000Z' }],
  models: [{ partNo: 'HH1234567', fileId: 'file-1', updatedAt: '2026-09-17T08:16:00.000Z' }],
  partFacts: [],
} as Parameters<typeof buildBackup>[1];

describe('JSONバックアップの中身', () => {
  it('部品表と図面リンクの両方を1ファイルにまとめる', () => {
    const backup = buildBackup(data, drawings, new Date('2026-09-17T08:20:00.000Z'));
    expect(backup.kind).toBe('matrix-parts-list-backup');
    expect(backup.version).toBe(1);
    expect(backup.exportedAt).toBe('2026-09-17T08:20:00.000Z');
    expect(backup.data).toEqual(data);
    expect(backup.drawings.drawings).toHaveLength(1);
    expect(backup.drawings.cadIds).toHaveLength(1);
    expect(backup.drawings.models).toHaveLength(1);
  });

  it('図面リンク側で欠けている項目は空配列で補う', () => {
    const backup = buildBackup(data, { revision: 1, updatedAt: '2026-09-17T08:16:00.000Z', drawings: [] });
    expect(backup.drawings).toMatchObject({ cadIds: [], models: [], partFacts: [] });
  });

  it('書き出したバックアップをそのまま読み戻せる', () => {
    const restored = parseBackup(JSON.stringify(buildBackup(data, drawings)));
    expect(restored.data).toEqual(data);
    expect(restored.drawings).toEqual(drawings);
  });

  it('部品表だけの古いバックアップも復元できる（図面リンクはなし）', () => {
    const restored = parseBackup(JSON.stringify(data));
    expect(restored.data).toEqual(data);
    expect(restored.drawings).toBeNull();
  });

  it('部品表として読めないJSONは例外にする', () => {
    expect(() => parseBackup('{}')).toThrow();
    expect(() => parseBackup('[]')).toThrow();
    expect(() => parseBackup('{"lists":"x"}')).toThrow();
    expect(() => parseBackup('こわれたJSON')).toThrow();
  });

  it('整形せずに書き出すため、インデント付きより小さくなる', () => {
    const backup = buildBackup(data, drawings);
    expect(JSON.stringify(backup).length).toBeLessThan(JSON.stringify(backup, null, 2).length);
  });
});
