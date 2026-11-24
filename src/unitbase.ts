import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseCsv } from './csv';

/**
 * UnitBase（技管の化学物質管理）から出力したCSVのうち、単体BOMに出す2列だけを持ちます。
 *
 * - `chemSHERPA(import)`: 「chemSHERPA調査状況」（技管からサプライヤへの調査ステータス。`-` はchemSHERPA入手不可）
 * - `備考(import)`: 「備考」
 *
 * UnitBaseは随時更新されるため、アプリ内で手入力はさせず、**CSVを丸ごと取り込み直す**ことで
 * 更新します（UnitBaseのCSVをGoogleスプレッドシートへ貼り付け、アプリでそのシートを読み込む）。取り込むたびに前回の内容をすべて置き換えるので、UnitBase側で消えた・変わった
 * 値もそのまま反映されます。
 */

/** 1件ぶんの値。同じ品番が工程ごとに分かれている（調査品番の末尾 `-1`, `-2`）ことがあるため、調査品番も持つ。 */
export type UnitBaseEntry = { surveyNo: string; status: string; note: string };

export type UnitBaseData = {
  /** 取り込んだファイル名（例: `化学物質管理V2_20261124-1624.csv`）。 */
  fileName: string;
  /** 取り込んだ日時。 */
  importedAt: string;
  /** 取り込み元のファイル（スプレッドシート）の更新日時。最新かどうかの判定に使う。 */
  sourceModifiedAt?: string;
  /** CSVの行数（見出しを除く）。 */
  rowCount: number;
  /** 品番 → 値。2列とも空の行は持たない。 */
  entries: Record<string, UnitBaseEntry[]>;
};

/** 表に出す値。工程が複数あるときは `-1: 完了` のように調査品番の枝番を添えて並べる。 */
export type UnitBaseValue = { status: string; note: string };
export type UnitBaseLookup = (partNo: string) => UnitBaseValue | undefined;

/** 単体BOMの列名。Excel出力でも同じ名前を使う。 */
export const UNITBASE_STATUS_COLUMN = 'chemSHERPA(import)';
export const UNITBASE_NOTE_COLUMN = '備考(import)';

/**
 * UnitBaseから手動で出力したCSVを貼り付けておくGoogleスプレッドシート。
 * 「スプレッドシートから更新」は、このシートの**先頭のシート**を読み込む。
 * 別のシートを使うときは、画面の「リンク変更」から差し替える（端末ごとに保存）。
 */
export const DEFAULT_UNITBASE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1OYppqGm1iRDdK2z8_GwFfRUF1QAj4_-ird5_fb6O1Fk/edit';
const SHEET_URL_KEY = 'matrix-parts-list.unitbase-sheet-url';

/** スプレッドシートのリンク（`/spreadsheets/d/<ID>/…`）またはIDそのものから、ファイルIDを取り出す。 */
export function spreadsheetIdFrom(value: string): string {
  const text = value.trim();
  const found = /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(text) ?? /[?&]id=([A-Za-z0-9_-]{20,})/.exec(text);
  if (found) return found[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(text) ? text : '';
}

export function loadSheetUrl(): string {
  try { return localStorage.getItem(SHEET_URL_KEY) || DEFAULT_UNITBASE_SHEET_URL; } catch { return DEFAULT_UNITBASE_SHEET_URL; }
}
export function saveSheetUrl(url: string) {
  try { if (url && url !== DEFAULT_UNITBASE_SHEET_URL) localStorage.setItem(SHEET_URL_KEY, url); else localStorage.removeItem(SHEET_URL_KEY); } catch { /* 保存できない環境では既定のリンクを使う。 */ }
}

const normalizeKey = (partNo: string) => partNo.trim().toUpperCase();

/**
 * UnitBaseのCSVは Shift_JIS で出力される。UTF-8として読めるならUTF-8、
 * 読めなければ Shift_JIS として読む（Excelで保存し直したCSVにも対応するため）。
 */
export function decodeUnitBaseCsv(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('shift_jis').decode(buffer);
  }
}

/**
 * 見出しの頭の文字で列を探す。UnitBaseの見出しは
 * `chemSHERPA調査状況 (技管からサプライヤへの…)` のように説明が付くため、完全一致では探さない。
 */
const findColumn = (header: string[], ...names: string[]) =>
  header.findIndex(cell => names.some(name => cell.replace(/\s+/g, '').startsWith(name)));

export function parseUnitBaseCsv(text: string, fileName: string, sourceModifiedAt?: string, at: Date = new Date()): UnitBaseData {
  const rows = parseCsv(text);
  const headerIndex = rows.findIndex(row => findColumn(row, 'chemSHERPA調査状況') >= 0);
  if (headerIndex < 0) throw new Error('UnitBaseのCSVではありません。「chemSHERPA調査状況」の列が見つかりません。');
  const header = rows[headerIndex];
  const partCol = findColumn(header, '品番');
  const surveyCol = findColumn(header, '調査品番');
  const statusCol = findColumn(header, 'chemSHERPA調査状況');
  const noteCol = header.findIndex(cell => cell.trim() === '備考');
  if (partCol < 0) throw new Error('UnitBaseのCSVに「品番 (子品番単位)」の列が見つかりません。');
  if (noteCol < 0) throw new Error('UnitBaseのCSVに「備考」の列が見つかりません。');

  const entries: Record<string, UnitBaseEntry[]> = {};
  let rowCount = 0;
  for (const row of rows.slice(headerIndex + 1)) {
    const partNo = normalizeKey(row[partCol] ?? '');
    if (!partNo) continue;
    rowCount += 1;
    const status = (row[statusCol] ?? '').trim(), note = (row[noteCol] ?? '').trim();
    if (!status && !note) continue;
    (entries[partNo] ??= []).push({ surveyNo: surveyCol >= 0 ? (row[surveyCol] ?? '').trim() : '', status, note });
  }
  /* 工程の枝番（-1, -2）の順に並べておく。 */
  for (const list of Object.values(entries)) list.sort((a, b) => a.surveyNo.localeCompare(b.surveyNo, 'ja', { numeric: true }));
  return { fileName, importedAt: at.toISOString(), sourceModifiedAt, rowCount, entries };
}

/** 調査品番の枝番（`HH0D125063-2` → `-2`）。枝番がないものは空。 */
const branchOf = (entry: UnitBaseEntry, partNo: string) => {
  const rest = entry.surveyNo.toUpperCase().startsWith(partNo) ? entry.surveyNo.slice(partNo.length) : '';
  return rest || '';
};

/** 品番に一致する値。工程が複数あれば1行ずつ並べ、どの工程の値かを枝番で示す。 */
export function unitBaseValue(data: UnitBaseData | undefined, partNo: string): UnitBaseValue | undefined {
  if (!data) return undefined;
  const key = normalizeKey(partNo);
  const list = data.entries[key];
  if (!list?.length) return undefined;
  if (list.length === 1) return { status: list[0].status, note: list[0].note };
  const label = (entry: UnitBaseEntry, value: string) => {
    const branch = branchOf(entry, key);
    return branch ? `${branch}: ${value || '—'}` : value;
  };
  return {
    status: list.map(entry => label(entry, entry.status)).join('\n'),
    note: list.filter(entry => entry.note).map(entry => label(entry, entry.note)).join('\n'),
  };
}

/* ---- 端末への保存（IndexedDB）---- */

const DB = 'matrix-parts-list-unitbase', STORE = 'state', KEY = 'latest';
const openDb = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DB, 1);
  request.onupgradeneeded = () => request.result.createObjectStore(STORE);
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
export async function loadUnitBase(): Promise<UnitBaseData | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(KEY);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function saveUnitBase(data: UnitBaseData | undefined): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    if (data) tx.objectStore(STORE).put(data, KEY); else tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 新しい方を採用するための比較。取り込んだ日時が新しいものを新しいとみなす。 */
export const isNewerUnitBase = (candidate: UnitBaseData | undefined, current: UnitBaseData | undefined) =>
  !!candidate && (!current || candidate.importedAt > current.importedAt);

/**
 * 取り込み済みのUnitBaseを持つ。正本はGoogle Drive（`MatrixPartsList-unitbase.json`）で、
 * 部品表・図面リンクと同じ同期で読み書きする。IndexedDBは、起動直後やオフラインでも
 * 表示できるようにするための写しとして使う。
 */
export function useUnitBase() {
  const [data, setData] = useState<UnitBaseData | undefined>();
  /* 端末の写しを読み終えるまでは、Driveとの同期で新旧を比べられないため待ってもらう。 */
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    loadUnitBase().then(saved => setData(current => current ?? saved)).catch(() => undefined).finally(() => setLoaded(true));
  }, []);
  const replace = useCallback(async (next: UnitBaseData | undefined) => {
    setData(next);
    await saveUnitBase(next);
  }, []);
  const lookup = useMemo<UnitBaseLookup>(() => partNo => unitBaseValue(data, partNo), [data]);
  return { data, loaded, replace, lookup };
}
