import { useRef, useState } from 'react';
import { DRIVE_FULL_SCOPE, downloadSpreadsheetCsv, signIn } from './drive';
import { decodeUnitBaseCsv, loadSheetUrl, parseUnitBaseCsv, saveSheetUrl, spreadsheetIdFrom, type UnitBaseData } from './unitbase';

type Props = {
  data: UnitBaseData | undefined;
  onReplace: (data: UnitBaseData) => Promise<void>;
};

const formatDate = (iso: string | undefined) => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/**
 * UnitBase（化学物質管理）のデータを取り込む帯。単体BOMの上に出す。
 *
 * UnitBaseは随時更新され、出力はCSVを手動で行う。出力したCSVをGoogleスプレッドシートへ
 * 貼り付け（ファイル → インポート → 現在のシートを置換）、ここで「スプレッドシートから更新」を
 * 押すと、アプリの内容をそのシートで置き換える。スプレッドシートを使わず、手元のCSVを直接
 * 選んで取り込むこともできる。
 */
export default function UnitBaseBar({ data, onReplace }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [sheetUrl, setSheetUrl] = useState(loadSheetUrl);
  const fileInput = useRef<HTMLInputElement>(null);

  const apply = async (next: UnitBaseData) => {
    await onReplace(next);
    setMessage({ text: `${next.fileName} を取り込みました（${next.rowCount.toLocaleString()} 行・値のある品番 ${Object.keys(next.entries).length.toLocaleString()} 件）。`, error: false });
  };
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try { await task(); }
    catch (error) { setMessage({ text: error instanceof Error ? error.message : '取り込みに失敗しました。', error: true }); }
    finally { setBusy(false); }
  };

  const importFromSheet = () => run(async () => {
    const id = spreadsheetIdFrom(sheetUrl);
    if (!id) throw Error('スプレッドシートのリンクが正しくありません。「リンク変更」から設定し直してください。');
    /* 手で作ったスプレッドシートを読むため、Drive全体の権限で求める（ポップアップはボタンを押したその場で開く）。 */
    await signIn({ scope: DRIVE_FULL_SCOPE });
    const sheet = await downloadSpreadsheetCsv(id);
    if (data && data.sourceModifiedAt === sheet.modifiedTime && data.fileName === sheet.name) {
      setMessage({ text: `スプレッドシートは前回の取り込みから更新されていません（${formatDate(sheet.modifiedTime)}）。`, error: false });
      return;
    }
    await apply(parseUnitBaseCsv(sheet.text, sheet.name, sheet.modifiedTime));
  });

  const importFromFile = (file: File | undefined) => {
    if (!file) return;
    void run(async () => {
      const buffer = await file.arrayBuffer();
      await apply(parseUnitBaseCsv(decodeUnitBaseCsv(buffer), file.name, new Date(file.lastModified).toISOString()));
    });
  };

  const changeLink = () => {
    const value = window.prompt('UnitBaseを貼り付けたGoogleスプレッドシートのリンクを入力してください（先頭のシートを読み込みます）。', sheetUrl);
    if (value === null) return;
    if (!spreadsheetIdFrom(value)) { setMessage({ text: 'スプレッドシートのリンク（https://docs.google.com/spreadsheets/d/…）を入力してください。', error: true }); return; }
    setSheetUrl(value.trim());
    saveSheetUrl(value.trim());
    setMessage({ text: 'スプレッドシートのリンクを変更しました。「スプレッドシートから更新」で読み込みます。', error: false });
  };

  return <div className="unitbase-bar">
    <span>UnitBase（chemSHERPA調査状況・備考）:</span>
    {data
      ? <span title={`アプリへの取込: ${formatDate(data.importedAt)}`}><b>{data.fileName}</b>{data.sourceModifiedAt && `（更新 ${formatDate(data.sourceModifiedAt)}）`}</span>
      : <span className="solo-blank">未取込</span>}
    <button type="button" className="unitbase-update" disabled={busy} onClick={() => void importFromSheet()}
      title="Googleスプレッドシート（先頭のシート）を読み込み、前回の内容をすべて置き換えます。">
      {busy ? '取込中…' : '↻ スプレッドシートから更新'}
    </button>
    <a href={sheetUrl} target="_blank" rel="noreferrer" title="UnitBaseを貼り付けるスプレッドシートを開きます">シートを開く</a>
    <button type="button" className="unitbase-link" disabled={busy} onClick={changeLink} title="読み込むスプレッドシートを変更します（このパソコンに保存）">リンク変更</button>
    <button type="button" className="unitbase-link" disabled={busy} onClick={() => fileInput.current?.click()} title="スプレッドシートを使わず、手元のUnitBaseのCSVを直接取り込みます。前回の内容はすべて置き換えます。">CSVから取込</button>
    <input ref={fileInput} type="file" accept=".csv,text/csv" hidden onChange={event => { importFromFile(event.target.files?.[0]); event.target.value = ''; }} />
    {message && <span className={`unitbase-message ${message.error ? 'is-error' : ''}`}>{message.text}</span>}
  </div>;
}
