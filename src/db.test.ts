import { describe, expect, it } from 'vitest';
import { backupFileName } from './db';

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
