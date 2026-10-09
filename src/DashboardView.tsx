import { useState, type ReactNode } from 'react';
import * as XLSX from 'xlsx';
import { MACHINES } from './plModes';
import { sortPartsLists } from './matrix';
import type { PartsList } from './types';

type Props = {
  lists: PartsList[];
  onOpenUnit: (machineId: string, modeId: string) => void;
  onNoteChange: (listId: string, note: string) => void;
  /** PLの3Dモデルのサムネイル。未登録のときはnullを返す。 */
  renderThumbnail?: (plNo: string) => ReactNode;
  /** PLの種類（STD・CST）や図面（PDF・EASMなど）の印。PL一覧と同じものを出す。 */
  renderBadges?: (plNo: string) => ReactNode;
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

const MACHINE_ORDER_KEY = 'matrix-parts-list.dashboard-machine-order';
type Machine = (typeof MACHINES)[number];

/** 保存した並び順で機種を並べる。保存にない機種（後から増えた機種）は元の順で後ろに付ける。 */
export function orderMachines(machines: readonly Machine[], order: string[]): Machine[] {
  const rank = new Map(order.map((id, index) => [id, index]));
  return machines.map((machine, index) => ({ machine, index }))
    .sort((a, b) => (rank.get(a.machine.id) ?? order.length + a.index) - (rank.get(b.machine.id) ?? order.length + b.index))
    .map(item => item.machine);
}

/** `from` の機種を `to` の機種の位置へ移した並び順を返す。 */
export function moveMachineId(ids: string[], from: string, to: string): string[] {
  const start = ids.indexOf(from), end = ids.indexOf(to);
  if (start < 0 || end < 0 || start === end) return ids;
  const next = [...ids];
  next.splice(start, 1);
  next.splice(end, 0, from);
  return next;
}

/* 並び順は見る人ごとの好みのため、この端末のブラウザーにだけ保存する。 */
function readMachineOrder(): string[] {
  try { const saved = JSON.parse(localStorage.getItem(MACHINE_ORDER_KEY) ?? '[]'); return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : []; } catch { return []; }
}
function saveMachineOrder(order: string[]) {
  try { localStorage.setItem(MACHINE_ORDER_KEY, JSON.stringify(order)); } catch { /* 保存できなくても並べ替えはできる */ }
}

function exportMachinePartsLists(machine: (typeof MACHINES)[number], lists: PartsList[]) {
  const rows = buildMachinePartsListRows(machine, lists);
  const sheet = XLSX.utils.json_to_sheet(rows, { header: ['ユニット名', 'PL', 'PL名称', 'PL Ver.', '備考'] });
  sheet['!cols'] = [{ wch: 28 }, { wch: 18 }, { wch: 42 }, { wch: 10 }, { wch: 36 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, machine.label);
  XLSX.writeFile(workbook, `${machine.label}_登録PL一覧.xlsx`);
}

export default function DashboardView({ lists, onOpenUnit, onNoteChange, renderThumbnail, renderBadges }: Props) {
  const [expandedUnits, setExpandedUnits] = useState<Set<string>>(new Set());
  const toggleUnit = (key: string) => setExpandedUnits(current => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  /* 機種ごとにも折りたためるようにする。最初はすべて開いておく。 */
  const [collapsedMachines, setCollapsedMachines] = useState<Set<string>>(new Set());
  /* 機種の塊は、左端のつまみをドラッグして並べ替えられる。 */
  const [machineOrder, setMachineOrder] = useState<string[]>(readMachineOrder);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const orderedMachines = orderMachines(MACHINES, machineOrder);
  const dropMachine = (target: string) => {
    if (dragging && dragging !== target) {
      const next = moveMachineId(orderedMachines.map(machine => machine.id), dragging, target);
      setMachineOrder(next);
      saveMachineOrder(next);
    }
    setDragging(null); setDragOver(null);
  };
  const toggleMachine = (id: string) => setCollapsedMachines(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return <section className="dashboard-view" aria-labelledby="dashboard-title">
    <div className="dashboard-heading">
      <div><h2 id="dashboard-title">登録状況ダッシュボード</h2><p>ユニットをクリックすると、登録済みのPLとPL名称を確認できます。</p></div>
      <strong>{lists.length}<span> 登録PL</span></strong>
    </div>
    <div className="machine-tree">{orderedMachines.map(machine => {
      const machineLists = lists.filter(list => list.machineId === machine.id);
      const machineExpanded = !collapsedMachines.has(machine.id);
      return <section className={`machine-branch ${machineExpanded ? '' : 'is-collapsed'} ${dragging === machine.id ? 'is-dragging' : ''} ${dragOver === machine.id && dragging !== machine.id ? 'is-drag-over' : ''}`} key={machine.id}
        onDragOver={event => { if (!dragging) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; if (dragOver !== machine.id) setDragOver(machine.id); }}
        onDrop={event => { event.preventDefault(); dropMachine(machine.id); }}
        onDragEnd={() => { setDragging(null); setDragOver(null); }}>
        <div className="machine-node"><span className="machine-grip" aria-hidden="true" title="ドラッグして機種の順序を変更" draggable
          onDragStart={event => { const block = event.currentTarget.closest('.machine-branch'); if (block) event.dataTransfer.setDragImage(block, 20, 20); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', machine.id); setDragging(machine.id); }}>⋮⋮</span><button className="machine-toggle" type="button" aria-expanded={machineExpanded} aria-controls={`dashboard-machine-${machine.id}`} onClick={() => toggleMachine(machine.id)}><span className="tree-icon" aria-hidden="true">▾</span><div><b>{machine.label}</b><small>{machine.modes.length} ユニット</small></div></button><div className="machine-node-actions"><strong>{machineLists.length}件</strong><button className="excel" type="button" onClick={() => exportMachinePartsLists(machine, lists)}>Excel DL</button></div></div>
        {machineExpanded && <ul id={`dashboard-machine-${machine.id}`}>{machine.modes.map(mode => {
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
              <div className="dashboard-pl-header"><span>PL</span><span>図面など</span><span>3Dモデル</span><span>PL名称</span><span>備考</span></div>
              {unitLists.length ? unitLists.map(list => <div className="dashboard-pl-row" key={list.id}>
                <b>{list.plNo}{list.plVersion ? <small> v{list.plVersion}</small> : null}</b>
                <span className="dashboard-pl-badges pl-badges">{renderBadges?.(list.plNo)}</span>
                <span className="dashboard-pl-thumb">{renderThumbnail?.(list.plNo)}</span>
                <span>{list.plName || '—'}</span>
                <input value={list.note ?? ''} onChange={event => onNoteChange(list.id, event.target.value)} aria-label={`${list.plNo}の備考`} placeholder="備考を入力" />
              </div>) : <p className="dashboard-unit-empty">登録済みPLはありません。</p>}
            </div>}
          </li>;
        })}</ul>}
      </section>;
    })}</div>
  </section>;
}
