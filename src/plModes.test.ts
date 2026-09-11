import { describe, expect, it } from 'vitest';
import { LEVEL40_MODE_ID, MACHINES, PL_MODES, defaultPlSelection, inferMachine, inferPlMode, isLevel40No, loadPlSelection, plModeLabel, plModesForMachine, resolvePlMode } from './plModes';

describe('PL display modes', () => {
  it('contains the 27 supported modes', () => {
    expect(PL_MODES).toHaveLength(27);
    expect(plModeLabel('SRC350', '01')).toBe('01 DRIVE GEAR BOX');
    expect(plModeLabel('SRC350', '27')).toBe('27 LOGO STICKER');
    expect(MACHINES.map(machine => machine.id)).toEqual(['SRC350', 'HU300']);
    expect(plModesForMachine('HU300').map(mode => mode.label)).toEqual([
      '01 HOIST UNIT', '02 HAND UNIT', '03 CARRY FIXTURE(JIG)', '40 40レベル部品',
    ]);
    // 40レベル部品は機種ごとに同じユニットとして持つ。
    expect(plModesForMachine('SRC350').at(-1)?.id).toBe(LEVEL40_MODE_ID);
  });

  it('infers attributes from file names or PL names', () => {
    expect(inferPlMode('SRC350', '01_DRIVE_GEAR_BOX_2.csv')).toBe('01');
    expect(inferPlMode('SRC350', 'HH110A0010_2.csv', 'DRIVE GEAR BOX (350M3)')).toBe('01');
    expect(inferPlMode('HU300', '03 CARRY FIXTURE(JIG).xlsx')).toBe('03');
    expect(inferPlMode('SRC350', 'unknown.csv', 'unknown')).toBe('');
    expect(inferMachine('HU300_01_HOIST_UNIT.csv')).toBe('HU300');
    expect(inferMachine('DRIVE GEAR BOX (350M3)')).toBe('SRC350');
    expect(inferMachine('HH3321P610_3.csv', 'REAR FRAME (5X_short-MRSP)')).toBe('SRC350');
    expect(inferMachine('HH0001.csv', 'HAND UNIT')).toBe('HU300');
    expect(inferMachine('HH0002.csv', 'HAND UNIT (350M3)')).toBe('SRC350');
    for (const machine of MACHINES) {
      // 40レベル部品は機種を問わない共通のユニットのため、機種の推定には使わない。
      for (const mode of machine.modes) {
        if (mode.id === LEVEL40_MODE_ID) continue;
        expect(inferMachine(mode.label)).toBe(machine.id);
      }
    }
    expect(inferMachine('40 40レベル部品')).toBe('');
    expect(inferPlMode('SRC350', '40 40レベル部品.csv')).toBe('');
    expect(inferMachine('unknown.csv')).toBe('');
  });
});

describe('40レベル（9桁目が4）の部品', () => {
  it('9桁目が4の番号だけを40レベルとみなす', () => {
    expect(isLevel40No('HJ1BL04340')).toBe(true);
    expect(isLevel40No(' hj1bl04340 ')).toBe(true);
    expect(isLevel40No('HJ021040400')).toBe(true);
    // PL（9桁目が1）・部品図（5・6）・桁数の違う番号は40レベルではない。
    expect(isLevel40No('HJ02100010')).toBe(false);
    expect(isLevel40No('HJ02101060')).toBe(false);
    expect(isLevel40No('Z080670500')).toBe(false);
    expect(isLevel40No('HJ1BL0434')).toBe(false);
    expect(isLevel40No('')).toBe(false);
  });

  it('ユニットを推定せず、専用のユニットへまとめる', () => {
    // 40レベルはユニット名がファイル名・PL名称にあっても専用のユニットにする。
    expect(resolvePlMode('HU300', 'HJ1BL04340', 'HJ1BL04340_2.csv', 'ASSY Z-axis Origin Sensor')).toBe(LEVEL40_MODE_ID);
    expect(resolvePlMode('SRC350', 'HJ1BL04340', '01_DRIVE_GEAR_BOX_2.csv')).toBe(LEVEL40_MODE_ID);
    // PLはこれまでどおり、ファイル名・PL名称からユニットを推定する。
    expect(resolvePlMode('SRC350', 'HH110A0010', 'HH110A0010_2.csv', 'DRIVE GEAR BOX (350M3)')).toBe('01');
    expect(resolvePlMode('SRC350', 'HH110A0010', 'unknown.csv')).toBe('');
  });
});

describe('機種・ユニットの選択の保存', () => {
  it('保存された選択をそのまま復元する', () => {
    expect(loadPlSelection(JSON.stringify({ machineId: 'HU300', modeId: '02' }))).toEqual({ machineId: 'HU300', modeId: '02' });
    expect(loadPlSelection(JSON.stringify({ machineId: 'SRC350', modeId: '21' }))).toEqual({ machineId: 'SRC350', modeId: '21' });
  });

  it('保存がない・壊れている・今の一覧にないときは既定へ戻す', () => {
    const fallback = defaultPlSelection();
    expect(fallback).toEqual({ machineId: 'SRC350', modeId: '01' });
    expect(loadPlSelection(null)).toEqual(fallback);
    expect(loadPlSelection('')).toEqual(fallback);
    expect(loadPlSelection('{壊れたJSON')).toEqual(fallback);
    expect(loadPlSelection(JSON.stringify({ machineId: 'UNKNOWN', modeId: '01' }))).toEqual(fallback);
  });

  it('機種はあるがユニットが無いときは、その機種の先頭のユニットにする', () => {
    expect(loadPlSelection(JSON.stringify({ machineId: 'HU300', modeId: '99' }))).toEqual({ machineId: 'HU300', modeId: '01' });
    expect(loadPlSelection(JSON.stringify({ machineId: 'HU300' }))).toEqual({ machineId: 'HU300', modeId: '01' });
  });
});
