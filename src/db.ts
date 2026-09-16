import type { AppData } from './types';
import type { DrawingData } from './drawings';
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
