import { describe, expect, it } from 'vitest';
import { isLevel40No, isPlLevelNo, levelNoKey, partLevelLabel, partLevelOf } from './levels';

describe('品番の階層（9桁目）', () => {
  it('10レベル・40レベル・50/60レベルを9桁目で見分ける', () => {
    // 10レベル＝PL。ユニットの部品表としてマトリックスに並べる。
    expect(partLevelOf('HJ02100010')).toBe('10');
    expect(partLevelOf('HH110A0010')).toBe('10');
    // 40レベル＝分解できる部品。部品と同じ扱いで、機種・ユニットに属さない。
    expect(partLevelOf('HJ1BL04340')).toBe('40');
    expect(partLevelOf('hj1bl04340')).toBe('40');
    expect(partLevelOf('HJ021040400')).toBe('40');
    // 50/60レベル＝これ以上分解しない部品。
    expect(partLevelOf('HJ02101050')).toBe('5060');
    expect(partLevelOf('HJ02101060')).toBe('5060');
  });

  it('桁数が合わない番号・その他の9桁目は階層なしにする', () => {
    expect(partLevelOf('Z080670500')).toBe('');
    expect(partLevelOf('HJ1BL0434')).toBe('');
    expect(partLevelOf('+')).toBe('');
    expect(partLevelOf('')).toBe('');
  });

  it('階層の呼び名と判定を返す', () => {
    expect(partLevelLabel('HJ02100010')).toBe('10レベル');
    expect(partLevelLabel('HJ1BL04340')).toBe('40レベル');
    expect(partLevelLabel('HJ02101060')).toBe('50/60レベル');
    expect(partLevelLabel('Z080670500')).toBe('');
    expect(isPlLevelNo('HJ02100010')).toBe(true);
    expect(isPlLevelNo('HJ1BL04340')).toBe(false);
    expect(isLevel40No('HJ1BL04340')).toBe(true);
    expect(isLevel40No('HJ02100010')).toBe(false);
  });

  it('大文字・前後の空白を無視して番号を結び付ける', () => {
    expect(levelNoKey(' hj1bl04340 ')).toBe('HJ1BL04340');
  });
});
