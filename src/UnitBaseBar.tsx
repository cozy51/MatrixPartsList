import { useRef, useState } from 'react';
import { parseUnitBaseCsv, unitBaseTextFromFile, type UnitBaseData } from './unitbase';

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
 * UnitBaseは随時更新され、出力はCSVを手動で行う。出力したCSV（またはExcelで保存し直した
 * .xlsx）を「ファイルから取込」で選ぶか、この帯へドラッグ＆ドロップすると、アプリの内容を
 * そのファイルで置き換える。取り込んだ内容はクラウド（D1）へ同期され、他のパソコンにも反映される。
 */
export default function UnitBaseBar({ data, onReplace }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
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

  const importFromFile = (file: File | undefined) => {
    if (!file) return;
    void run(async () => {
      const buffer = await file.arrayBuffer();
      const modifiedAt = new Date(file.lastModified).toISOString();
      if (data && data.fileName === file.name && data.sourceModifiedAt === modifiedAt) {
        setMessage({ text: `${file.name} は前回の取り込みから更新されていません（${formatDate(modifiedAt)}）。`, error: false });
        return;
      }
      await apply(parseUnitBaseCsv(unitBaseTextFromFile(file.name, buffer), file.name, modifiedAt));
    });
  };

  return <div className={`unitbase-bar${dragging ? ' is-dragging' : ''}`}
    onDragOver={event => { if (!Array.from(event.dataTransfer.types).includes('Files')) return; event.preventDefault(); setDragging(true); }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
    onDrop={event => { event.preventDefault(); setDragging(false); importFromFile(event.dataTransfer.files[0]); }}>
    <span>UnitBase（chemSHERPA調査状況・備考）:</span>
    {data
      ? <span title={`アプリへの取込: ${formatDate(data.importedAt)}`}><b>{data.fileName}</b>{data.sourceModifiedAt && `（更新 ${formatDate(data.sourceModifiedAt)}）`}</span>
      : <span className="solo-blank">未取込</span>}
    <button type="button" className="unitbase-update" disabled={busy} onClick={() => fileInput.current?.click()}
      title="UnitBaseから出力したCSV（またはExcel）を選んで取り込みます。前回の内容はすべて置き換えます。この帯へドラッグ＆ドロップしても取り込めます。">
      {busy ? '取込中…' : '↻ ファイルから取込（CSV・Excel）'}
    </button>
    <input ref={fileInput} type="file" accept=".csv,.xlsx,.xlsm,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" hidden onChange={event => { importFromFile(event.target.files?.[0]); event.target.value = ''; }} />
    {message && <span className={`unitbase-message ${message.error ? 'is-error' : ''}`}>{message.text}</span>}
  </div>;
}
