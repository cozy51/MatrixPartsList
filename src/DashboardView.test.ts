import { describe, expect, it } from 'vitest';
import { buildMachinePartsListRows, moveMachineId, orderMachines } from './DashboardView';
import { MACHINES } from './plModes';
import type { PartsList } from './types';

const list = (id: string, machineId: string, modeId: string, plNo: string, plName: string, note = ''): PartsList => ({
  id, machineId, modeId, plNo, plName, note, plVersion: '02', fileName: `${plNo}.csv`, parts: [], visible: true, importedAt: '',
});

describe('dashboard Excel rows', () => {
  it('exports only the selected machine and orders rows by unit then PL number', () => {
    const src350 = MACHINES.find(machine => machine.id === 'SRC350')!;
    const rows = buildMachinePartsListRows(src350, [
      list('3', 'HU300', '01', 'HU1', 'HU HOIST'),
      list('2', 'SRC350', '02', 'PL10', 'STEERING 10'),
      list('6', 'SRC350', '01', 'HH110A0010', 'DRIVE A'),
      list('5', 'SRC350', '01', 'HH11002010', 'DRIVE 20'),
      list('4', 'SRC350', '01', 'HH11000010', 'DRIVE 00'),
      list('1', 'SRC350', '01', 'PL2', 'DRIVE 2', '要確認'),
    ]);
    expect(rows).toEqual([
      { ユニット名: '01 DRIVE GEAR BOX', PL: 'HH11000010', PL名称: 'DRIVE 00', 'PL Ver.': '02', 備考: '' },
      { ユニット名: '01 DRIVE GEAR BOX', PL: 'HH11002010', PL名称: 'DRIVE 20', 'PL Ver.': '02', 備考: '' },
      { ユニット名: '01 DRIVE GEAR BOX', PL: 'HH110A0010', PL名称: 'DRIVE A', 'PL Ver.': '02', 備考: '' },
      { ユニット名: '01 DRIVE GEAR BOX', PL: 'PL2', PL名称: 'DRIVE 2', 'PL Ver.': '02', 備考: '要確認' },
      { ユニット名: '02 STEERING UNIT(R)', PL: 'PL10', PL名称: 'STEERING 10', 'PL Ver.': '02', 備考: '' },
    ]);
  });
});

describe('dashboard machine order', () => {
  it('orders machines by the saved order and appends unknown machines in their original order', () => {
    const ids = orderMachines(MACHINES, [MACHINES[MACHINES.length - 1].id, 'UNKNOWN']).map(machine => machine.id);
    expect(ids).toEqual([MACHINES[MACHINES.length - 1].id, ...MACHINES.slice(0, -1).map(machine => machine.id)]);
  });
  it('moves a machine to the position of the drop target', () => {
    expect(moveMachineId(['A', 'B', 'C'], 'A', 'C')).toEqual(['B', 'C', 'A']);
    expect(moveMachineId(['A', 'B', 'C'], 'C', 'A')).toEqual(['C', 'A', 'B']);
    expect(moveMachineId(['A', 'B', 'C'], 'B', 'B')).toEqual(['A', 'B', 'C']);
  });
});
