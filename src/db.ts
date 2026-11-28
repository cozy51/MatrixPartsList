import type { AppData } from './types';
import type { DrawingData } from './drawings';
import type { UnitBaseData } from './unitbase';
const DB='matrix-parts-list',STORE='state',KEY='latest',DRAWING_KEY='drawings';
const open=()=>new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
async function load<T>(key:string):Promise<T|undefined>{const db=await open();return new Promise((resolve,reject)=>{const r=db.transaction(STORE).objectStore(STORE).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function save(key:string,value:unknown){const db=await open();return new Promise<void>((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(value,key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
export const loadLocal=()=>load<AppData>(KEY);
export const saveLocal=(data:AppData)=>save(KEY,data);
/** 図面リンクは部品表と別レコードで保存し、Drive上も別ファイルへ同期する。 */
export const loadLocalDrawings=()=>load<DrawingData>(DRAWING_KEY);
export const saveLocalDrawings=(data:DrawingData)=>save(DRAWING_KEY,data);

/**
 * JSONバックアップのファイル名。いつ取ったバックアップかをファイル名だけで
 * 見分けられるよう、取得した日時（そのパソコンの時刻）を付ける。
 * 例: `MatrixPartsList-backup_2026-09-17_0533.json`
 */
export function backupFileName(at: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  return `MatrixPartsList-backup_${date}_${pad(at.getHours())}${pad(at.getMinutes())}.json`;
}

/**
 * JSONバックアップの中身。以前は部品表（AppData）だけを保存していたため、
 * 図面リンク・CAD ID・3Dモデルリンクは復元できなかった。両方を1ファイルに
 * まとめて、バックアップ1つで元どおりに戻せるようにする。
 */
export type BackupFile = {
  kind: 'matrix-parts-list-backup';
  version: 1;
  exportedAt: string;
  data: AppData;
  drawings: DrawingData;
};

/** 図面リンク側は後から増えた項目があるため、欠けていても空配列で補う。 */
function normalizeDrawings(value: DrawingData): DrawingData {
  return {
    revision: value.revision || 0,
    updatedAt: value.updatedAt || new Date(0).toISOString(),
    drawings: value.drawings || [],
    cadIds: value.cadIds || [],
    models: value.models || [],
    partFacts: value.partFacts || [],
  };
}

export function buildBackup(data: AppData, drawings: DrawingData, at: Date = new Date()): BackupFile {
  return { kind: 'matrix-parts-list-backup', version: 1, exportedAt: at.toISOString(), data, drawings: normalizeDrawings(drawings) };
}

/**
 * バックアップJSONを読み取る。図面リンクを含む新しい形式と、部品表だけの
 * 古い形式（AppDataをそのまま保存したもの）のどちらも復元できる。
 * 中身が部品表として読めないときは例外を投げる。
 */
export function parseBackup(text: string): { data: AppData; drawings: DrawingData | null } {
  const parsed = JSON.parse(text) as Partial<BackupFile> & Partial<AppData>;
  // 新しい形式は `data` の下に部品表が入っている。古い形式は直下に `lists` がある。
  const data = (parsed.kind === 'matrix-parts-list-backup' ? parsed.data : parsed) as AppData | undefined;
  if (!data || !Array.isArray(data.lists)) throw new Error('バックアップJSONが不正です。');
  const drawings = parsed.kind === 'matrix-parts-list-backup' && parsed.drawings && Array.isArray(parsed.drawings.drawings)
    ? normalizeDrawings(parsed.drawings)
    : null;
  return { data: { ...data, revision: data.revision || 0, updatedAt: data.updatedAt || new Date(0).toISOString() }, drawings };
}

/** 復元するファイルから読み取った中身。選ばなかった種類は空のまま（今のデータを変えない）。 */
export type RestoreSet = { data?: AppData; drawings?: DrawingData; unitBase?: UnitBaseData };

/**
 * 復元するJSONを、中身の形で見分けて読み取る。1つ以上を同時に選べる。
 * - このアプリのJSONバックアップ（部品表＋図面リンク）
 * - Google Drive版のクラウドに保存していたファイル
 *   `MatrixPartsList-latest.json`（部品表）・`MatrixPartsList-drawings.json`（図面リンク・CAD ID・3Dモデル・質量など）・
 *   `MatrixPartsList-unitbase.json`（UnitBase）
 * 同じ種類が2つ以上あるとき・どれとも読めないファイルがあるときは、何も変えないよう例外を投げる。
 */
export function parseRestoreFiles(files: { name: string; text: string }[]): RestoreSet {
  const out: RestoreSet = {}, seen: Record<keyof RestoreSet, string> = { data: '', drawings: '', unitBase: '' };
  const put = <K extends keyof RestoreSet>(key: K, value: RestoreSet[K], name: string, label: string) => {
    if (seen[key]) throw new Error(`${label}のファイルが2つあります（${seen[key]}・${name}）。1つにしてください。`);
    seen[key] = name; out[key] = value;
  };
  for (const file of files) {
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(file.text) as Record<string, unknown>; } catch { throw new Error(`${file.name} はJSONとして読めません。`); }
    if (!parsed || typeof parsed !== 'object') throw new Error(`${file.name} は復元できる形式ではありません。`);
    if (parsed.kind === 'matrix-parts-list-backup' || Array.isArray(parsed.lists)) {
      const restored = parseBackup(file.text);
      put('data', restored.data, file.name, '部品表');
      if (restored.drawings) put('drawings', restored.drawings, file.name, '図面リンク');
    } else if (Array.isArray(parsed.drawings)) {
      put('drawings', normalizeDrawings(parsed as unknown as DrawingData), file.name, '図面リンク');
    } else if (parsed.entries && typeof parsed.entries === 'object' && typeof parsed.importedAt === 'string') {
      put('unitBase', parsed as unknown as UnitBaseData, file.name, 'UnitBase');
    } else throw new Error(`${file.name} は復元できる形式ではありません（部品表・図面リンク・UnitBaseのどれでもありません）。`);
  }
  if (!files.length) throw new Error('復元するファイルを選んでください。');
  return out;
}
