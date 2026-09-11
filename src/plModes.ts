export type PlMode = { id: string; label: string };
export type Machine = { id: string; label: string; modes: PlMode[] };

const SRC350_MODES: PlMode[] = [
  ['01', 'DRIVE GEAR BOX'], ['02', 'STEERING UNIT(R)'], ['03', 'STEERING UNIT(F)'],
  ['04', 'CORE UNIT'], ['05', 'DIVERGE UNIT(R)'], ['06', 'DIVERGE UNIT(F)'],
  ['07', 'HOIST GEAR BOX'], ['08', 'HOIST BASE UNIT'], ['09', 'HOIST DRUM UNIT'],
  ['10', 'HOIST SENSOR UNIT'], ['11', 'CENTER FRAME'], ['12', 'FRONT FRAME'],
  ['13', 'REAR FRAME'], ['14', 'FEEDER UNIT'], ['15', 'LAN UNIT'],
  ['16', 'E-84関係'], ['17', 'THETA UNIT'], ['18', 'LATERAL UNIT'],
  ['19', 'LATERAL GEAR BOX'], ['20', 'CRADLE'], ['21', 'HAND'], ['22', 'COVER'],
  ['23', 'HAZARD LABEL'], ['24', 'CARRY WAGON'], ['25', 'CLEANING NOZZLE UNIT'],
  ['26', 'CLEANER UNIT'], ['27', 'LOGO STICKER'],
].map(([id, name]) => ({ id, label: `${id} ${name}` }));

const HU300_MODES: PlMode[] = [
  ['01', 'HOIST UNIT'], ['02', 'HAND UNIT'], ['03', 'CARRY FIXTURE(JIG)'],
].map(([id, name]) => ({ id, label: `${id} ${name}` }));

export const MACHINES: Machine[] = [
  { id: 'SRC350', label: 'SRC350', modes: SRC350_MODES },
  { id: 'HU300', label: 'HU300', modes: HU300_MODES },
];
export const PL_MODES = SRC350_MODES;
export const plModesForMachine = (machineId: string) => MACHINES.find(machine => machine.id === machineId)?.modes ?? [];

const normalized = (value: string) => value.normalize('NFKC').toUpperCase()
  .replace(/\.(CSV|XLSX?|XLSM)$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();

export function inferMachine(...values: string[]): string {
  const text = values.map(normalized).join(' ');
  // An explicit machine marker takes precedence over a unit-name match. This
  // also handles names such as "HAND UNIT (350M3)" that resemble another
  // machine's unit name.
  if (/\bHU\s*300\b/.test(text)) return 'HU300';
  if (/\bSRC\s*350\b|\b350M\d*\b/.test(text)) return 'SRC350';

  // Otherwise infer the machine from the current unit catalogs. Prefer the
  // longest matching unit name so "HAND UNIT" wins over the shorter "HAND".
  const matches = MACHINES.flatMap(machine => machine.modes
    .map(mode => normalized(mode.label.replace(/^\d+\s+/, '')))
    .filter(name => text.includes(name))
    .map(name => ({ machineId: machine.id, length: name.length })));
  const longest = Math.max(0, ...matches.map(match => match.length));
  const machines = new Set(matches.filter(match => match.length === longest).map(match => match.machineId));
  return machines.size === 1 ? [...machines][0] : '';
}

export function inferPlMode(machineId: string, ...values: string[]): string {
  const candidates = values.map(normalized).filter(Boolean);
  for (const mode of plModesForMachine(machineId)) {
    const name = normalized(mode.label.replace(/^\d+\s+/, ''));
    if (candidates.some(value => value.includes(name))) return mode.id;
  }
  return '';
}

export const plModeLabel = (machineId: string, id: string) => plModesForMachine(machineId).find(mode => mode.id === id)?.label ?? 'ユニット未設定';

/**
 * 機種・ユニットの選択は、ページを読み込み直しても続きから見られるように
 * ブラウザーへ保存する。保存できない環境（プライベートウィンドウなど）でも
 * 動きは変えず、既定の選択で始める。
 */
export const PL_SELECTION_KEY = 'matrix-parts-list.selection.v1';

export type PlSelection = { machineId: string; modeId: string };

export const defaultPlSelection = (): PlSelection => {
  const machine = MACHINES[0];
  return { machineId: machine?.id ?? '', modeId: machine?.modes[0]?.id ?? '' };
};

/** 保存された選択を読む。機種・ユニットが今の一覧にないときは既定へ戻す。 */
export function loadPlSelection(saved: string | null): PlSelection {
  const fallback = defaultPlSelection();
  if (!saved) return fallback;
  let parsed: Partial<PlSelection>;
  try { parsed = JSON.parse(saved) as Partial<PlSelection>; } catch { return fallback; }
  const modes = plModesForMachine(parsed?.machineId ?? '');
  if (!modes.length) return fallback;
  return {
    machineId: parsed.machineId!,
    modeId: modes.some(mode => mode.id === parsed.modeId) ? parsed.modeId! : modes[0].id,
  };
}

/** ブラウザーから読む。読めない環境では既定の選択にする。 */
export function readPlSelection(): PlSelection {
  try { return loadPlSelection(localStorage.getItem(PL_SELECTION_KEY)); } catch { return defaultPlSelection(); }
}

export function savePlSelection(selection: PlSelection) {
  try { localStorage.setItem(PL_SELECTION_KEY, JSON.stringify(selection)); } catch { /* 保存できなくても動作は変えない */ }
}
