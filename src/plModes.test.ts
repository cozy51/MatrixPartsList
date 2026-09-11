import { describe, expect, it } from 'vitest';
import { MACHINES, PL_MODES, defaultPlSelection, inferMachine, inferPlMode, loadPlSelection, plModeLabel, plModesForMachine } from './plModes';

describe('PL display modes', () => {
  it('contains the 27 supported modes', () => {
    expect(PL_MODES).toHaveLength(27);
    expect(plModeLabel('SRC350', '01')).toBe('01 DRIVE GEAR BOX');
    expect(plModeLabel('SRC350', '27')).toBe('27 LOGO STICKER');
    expect(MACHINES.map(machine => machine.id)).toEqual(['SRC350', 'HU300']);
    expect(plModesForMachine('HU300').map(mode => mode.label)).toEqual([
      '01 HOIST UNIT', '02 HAND UNIT', '03 CARRY FIXTURE(JIG)',
    ]);
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
      for (const mode of machine.modes) expect(inferMachine(mode.label)).toBe(machine.id);
    }
    expect(inferMachine('unknown.csv')).toBe('');
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
