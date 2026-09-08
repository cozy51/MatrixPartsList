import { useState } from 'react';
import * as XLSX from 'xlsx';
import { MACHINES } from './plModes';
import { sortPartsLists } from './matrix';
import type { PartsList } from './types';

type Props = {
  lists: PartsList[];
  onOpenUnit: (machineId: string, modeId: string) => void;
  onNoteChange: (listId: string, note: string) => void;
};

export function buildMachinePartsListRows(machine: (typeof MACHINES)[number], lists: PartsList[]) {
  const modeOrder = new Map(machine.modes.map((mode, index) => [mode.id, index]));
  return sortPartsLists(lists.filter(list => list.machineId === machine.id))
    .sort((a, b) => (modeOrder.get(a.modeId) ?? 999) - (modeOrder.get(b.modeId) ?? 999))
    .map(list => ({
      ユニット名: machine.modes.find(mode => mode.id === list.modeId)?.label ?? list.modeId,
      PL: list.plNo,
      PL名称: list.plName,
      'PL Ver.': list.plVersion,
      備考: list.note ?? '',
    }));
}

function exportMachinePartsLists(machine: (typeof MACHINES)[number], lists: PartsList[]) {
  const rows = buildMachinePartsListRows(machine, lists);
  const sheet = XLSX.utils.json_to_sheet(rows, { header: ['ユニット名', 'PL', 'PL名称', 'PL Ver.', '備考'] });
  sheet['!cols'] = [{ wch: 28 }, { wch: 18 }, { wch: 42 }, { wch: 10 }, { wch: 36 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, machine.label);
  XLSX.writeFile(workbook, `${machine.label}_登録PL一覧.xlsx`);
}

export default function DashboardView({ lists, onOpenUnit, onNoteChange }: Props) {
  const [expandedUnits, setExpandedUnits] = useState<Set<string>>(new Set());
  const toggleUnit = (key: string) => setExpandedUnits(current => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  return <section className="dashboard-view" aria-labelledby="dashboard-title">
    <div className="dashboard-heading">
      <div><h2 id="dashboard-title">登録状況ダッシュボード</h2><p>ユニットをクリックすると、登録済みのPLとPL名称を確認できます。</p></div>
      <strong>{lists.length}<span> 登録PL</span></strong>
    </div>
    <div className="machine-tree">{MACHINES.map(machine => {
      const machineLists = lists.filter(list => list.machineId === machine.id);
      return <section className="machine-branch" key={machine.id}>
        <div className="machine-node"><span className="tree-icon" aria-hidden="true">▾</span><div><b>{machine.label}</b><small>{machine.modes.length} ユニット</small></div><div className="machine-node-actions"><strong>{machineLists.length}件</strong><button className="excel" type="button" onClick={() => exportMachinePartsLists(machine, lists)}>Excel DL</button></div></div>
        <ul>{machine.modes.map(mode => {
          const unitLists = sortPartsLists(machineLists.filter(list => list.modeId === mode.id));
          const unitKey = `${machine.id}-${mode.id}`;
          const expanded = expandedUnits.has(unitKey);
          return <li className={expanded ? 'is-expanded' : ''} key={mode.id}>
            <span className="tree-line" aria-hidden="true" />
            <div className="dashboard-unit-row">
              <button className="dashboard-unit-toggle" type="button" aria-expanded={expanded} aria-controls={`dashboard-unit-${unitKey}`} onClick={() => toggleUnit(unitKey)}>
                <span className="unit-chevron" aria-hidden="true">›</span><span>{mode.label}</span><strong>{unitLists.length}件</strong>
              </button>
              <button className="dashboard-link" type="button" onClick={() => onOpenUnit(machine.id, mode.id)} aria-label={`${machine.label} ${mode.label}の部品表を開く`}>部品表へ →</button>
            </div>
            {expanded && <div className="dashboard-unit-lists" id={`dashboard-unit-${unitKey}`}>
              <div className="dashboard-pl-header"><span>PL</span><span>PL名称</span><span>備考</span></div>
              {unitLists.length ? unitLists.map(list => <div className="dashboard-pl-row" key={list.id}>
                <b>{list.plNo}{list.plVersion ? <small> v{list.plVersion}</small> : null}</b>
                <span>{list.plName || '—'}</span>
                <input value={list.note ?? ''} onChange={event => onNoteChange(list.id, event.target.value)} aria-label={`${list.plNo}の備考`} placeholder="備考を入力" />
              </div>) : <p className="dashboard-unit-empty">登録済みPLはありません。</p>}
            </div>}
          </li>;
        })}</ul>
      </section>;
    })}</div>
  </section>;
}
