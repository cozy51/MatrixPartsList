import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  drawingKey,
  isOpenableUrl,
  mergePartNos,
  parseDrawingClipboard,
  removeDrawing,
  searchDrawings,
  sortDrawings,
  upsertDrawing,
  type DrawingLink,
} from './drawings';

type Props = {
  drawings: DrawingLink[];
  onChange: (drawings: DrawingLink[]) => void;
  /** 登録済みPLの品番。対象品番の入力候補として使う。 */
  knownPartNos: string[];
};

type Draft = Omit<DrawingLink, 'updatedAt'> & { isNew: boolean };

const FILE_TYPES = ['PDF', 'DXF', 'DWG', 'TIFF', 'その他'];

const emptyDraft = (): Draft => ({
  id: crypto.randomUUID(), drawingNo: '', docNo: '', fileType: 'PDF', fileName: '', url: '', partNos: [], note: '', isNew: true,
});

function exportDrawings(drawings: DrawingLink[]) {
  const rows = sortDrawings(drawings).map(drawing => ({
    図番: drawing.drawingNo,
    種別: drawing.fileType,
    対象品番: drawing.partNos.join(' / '),
    管理番号: drawing.docNo,
    ファイル名: drawing.fileName,
    リンク: drawing.url,
    備考: drawing.note,
    更新日時: drawing.updatedAt.slice(0, 19).replace('T', ' '),
  }));
  const sheet = XLSX.utils.json_to_sheet(rows, { header: ['図番', '種別', '対象品番', '管理番号', 'ファイル名', 'リンク', '備考', '更新日時'] });
  sheet['!cols'] = [{ wch: 16 }, { wch: 8 }, { wch: 30 }, { wch: 12 }, { wch: 28 }, { wch: 60 }, { wch: 24 }, { wch: 20 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '図面リンク');
  XLSX.writeFile(workbook, '図面リンク一覧.xlsx');
}

export default function DrawingsView({ drawings, onChange, knownPartNos }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [partNoInput, setPartNoInput] = useState('');
  const [pasted, setPasted] = useState('');
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const listed = useMemo(() => sortDrawings(searchDrawings(drawings, search)), [drawings, search]);
  const partNoOptions = useMemo(() => [...new Set(knownPartNos.filter(partNo => partNo && partNo !== '+'))].sort(), [knownPartNos]);

  /**
   * 取り込んだリンクから図番を推定する。図番と品番は一致しないことがあるため、
   * 対象品番は図番の初期値を入れたうえで、利用者が自由に足し引きできるようにする。
   */
  const startDraft = (text: string) => {
    const parsed = parseDrawingClipboard(text);
    if (!parsed) {
      setError('リンク（http/https）が見つかりません。社内システムでPDF・DXFのリンクをコピーしてください。');
      return false;
    }
    setError('');
    setMessage('');
    const existing = drawings.find(drawing => drawing.url === parsed.url
      || (drawingKey(drawing.drawingNo) === drawingKey(parsed.drawingNo) && drawingKey(drawing.fileType) === drawingKey(parsed.fileType)));
    setDraft({
      id: existing?.id ?? crypto.randomUUID(),
      drawingNo: parsed.drawingNo,
      docNo: parsed.docNo,
      fileType: parsed.fileType,
      fileName: parsed.fileName,
      url: parsed.url,
      partNos: mergePartNos(existing?.partNos ?? [], parsed.drawingNo ? [parsed.drawingNo] : []),
      note: existing?.note ?? '',
      isNew: !existing,
    });
    return true;
  };

  const captureFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (startDraft(text)) setPasted(text);
    } catch {
      setError('クリップボードを読み取れませんでした。下の入力欄へ貼り付け（Ctrl+V）してください。');
    }
  };

  const changePasted = (text: string) => {
    setPasted(text);
    if (text.trim()) startDraft(text);
  };

  const addPartNos = (value: string) => {
    const added = value.split(/[\s,、;/]+/).filter(Boolean);
    if (!draft || !added.length) return;
    setDraft({ ...draft, partNos: mergePartNos(draft.partNos, added) });
    setPartNoInput('');
  };

  const save = () => {
    if (!draft) return;
    if (!draft.drawingNo.trim()) { setError('図番を入力してください。'); return; }
    if (!draft.url.trim()) { setError('図面のリンクを入力してください。'); return; }
    const partNos = mergePartNos(draft.partNos, partNoInput.split(/[\s,、;/]+/).filter(Boolean));
    if (!partNos.length) { setError('対象品番を1つ以上入力してください。図番と同じ場合は「図番と同じ」を押します。'); return; }
    const entry: DrawingLink = {
      id: draft.id,
      drawingNo: draft.drawingNo.trim(),
      docNo: draft.docNo.trim(),
      fileType: draft.fileType.trim() || 'その他',
      fileName: draft.fileName.trim(),
      url: draft.url.trim(),
      partNos,
      note: draft.note.trim(),
      updatedAt: new Date().toISOString(),
    };
    onChange(upsertDrawing(drawings, entry));
    setDraft(null);
    setPartNoInput('');
    setPasted('');
    setError('');
    setMessage(`${entry.drawingNo}（${entry.fileType}）を登録しました。`);
  };

  const edit = (drawing: DrawingLink) => {
    setDraft({ ...drawing, isNew: false });
    setPartNoInput('');
    setError('');
    setMessage('');
  };

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setMessage('リンクをコピーしました。');
    } catch {
      setError('リンクをコピーできませんでした。');
    }
  };

  return <section className="drawings-view">
    <div className="drawings-capture">
      <div className="drawings-capture-head">
        <div>
          <h2>図面リンクの取り込み</h2>
          <p>社内システムの品番マスタで PDF・DXF のリンクをコピーし、「クリップボードから取得」を押します。図番はリンクから自動判定し、品番とは別に管理します。</p>
        </div>
        <div className="drawings-capture-actions">
          <button className="primary" type="button" onClick={() => void captureFromClipboard()}>クリップボードから取得</button>
          <button type="button" onClick={() => { setDraft(emptyDraft()); setPartNoInput(''); setError(''); setMessage(''); }}>手入力で追加</button>
        </div>
      </div>
      <textarea
        className="drawings-paste"
        aria-label="図面リンクを貼り付け"
        placeholder="クリップボードを読み取れない場合は、ここへ貼り付け（Ctrl+V）してください。"
        value={pasted}
        onChange={event => changePasted(event.target.value)}
      />
    </div>

    {error && <div className="error">⚠ {error}<button type="button" onClick={() => setError('')}>×</button></div>}
    {message && <div className="drawings-message">{message}</div>}

    {draft && <form className="drawing-form" onSubmit={event => { event.preventDefault(); save(); }}>
      <h3>{draft.isNew ? '図面リンクを登録' : '図面リンクを編集'}</h3>
      <div className="drawing-form-grid">
        <label><span>図番</span><input value={draft.drawingNo} placeholder="必須" onChange={event => setDraft({ ...draft, drawingNo: event.target.value })} /></label>
        <label><span>種別</span><select value={draft.fileType} onChange={event => setDraft({ ...draft, fileType: event.target.value })}>{[...new Set([draft.fileType, ...FILE_TYPES])].filter(Boolean).map(type => <option key={type} value={type}>{type}</option>)}</select></label>
        <label><span>管理番号</span><input value={draft.docNo} placeholder="自動取得" onChange={event => setDraft({ ...draft, docNo: event.target.value })} /></label>
        <label className="drawing-form-wide"><span>リンク</span><input value={draft.url} placeholder="https://..." onChange={event => {
          const url = event.target.value;
          // 手入力でリンクを差し替えたときも、空欄の項目だけは自動判定を補う。
          const parsed = parseDrawingClipboard(url);
          setDraft({ ...draft, url, fileName: parsed?.fileName ?? '', drawingNo: draft.drawingNo || (parsed?.drawingNo ?? ''), docNo: draft.docNo || (parsed?.docNo ?? '') });
        }} /></label>
        <div className="drawing-form-wide">
          <span className="drawing-form-label">対象品番<small>図番と異なる品番や、流用先の品番を追加できます。</small></span>
          <div className="drawing-part-chips">
            {draft.partNos.map(partNo => <span className="drawing-chip" key={partNo}>{partNo}<button type="button" aria-label={`${partNo}を外す`} onClick={() => setDraft({ ...draft, partNos: draft.partNos.filter(item => item !== partNo) })}>×</button></span>)}
            <input
              list="drawing-part-options"
              value={partNoInput}
              placeholder="品番を入力してEnter"
              onChange={event => setPartNoInput(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addPartNos(partNoInput); } }}
              onBlur={() => addPartNos(partNoInput)}
            />
            <button type="button" onClick={() => addPartNos(draft.drawingNo)} disabled={!draft.drawingNo.trim()}>図番と同じ</button>
          </div>
          <datalist id="drawing-part-options">{partNoOptions.map(partNo => <option key={partNo} value={partNo} />)}</datalist>
        </div>
        <label className="drawing-form-wide"><span>備考</span><input value={draft.note} placeholder="流用元、改訂内容など" onChange={event => setDraft({ ...draft, note: event.target.value })} /></label>
      </div>
      <div className="drawing-form-actions">
        <button type="button" onClick={() => { setDraft(null); setPartNoInput(''); setError(''); }}>キャンセル</button>
        <button className="primary" type="submit">{draft.isNew ? '登録する' : '更新する'}</button>
      </div>
    </form>}

    <div className="drawings-list-head">
      <div><h3>登録済み図面リンク</h3><p>{drawings.length} 図面 ・ {new Set(drawings.flatMap(drawing => drawing.partNos.map(drawingKey))).size} 品番</p></div>
      <label className="search-box"><span aria-hidden="true">🔍</span><input className="search" aria-label="図番・品番で検索" placeholder="図番・品番・備考を検索..." value={search} onChange={event => setSearch(event.target.value)} /></label>
      <button type="button" onClick={() => exportDrawings(drawings)} disabled={!drawings.length}>Excel出力</button>
    </div>

    {listed.length ? <div className="drawings-table"><table>
      <thead><tr><th>図番</th><th>種別</th><th>対象品番</th><th>管理番号</th><th>備考</th><th>操作</th></tr></thead>
      <tbody>{listed.map(drawing => <tr key={drawing.id}>
        <td><b>{drawing.drawingNo}</b><small>{drawing.fileName}</small></td>
        <td><span className={`drawing-type ${drawing.fileType.toLowerCase()}`}>{drawing.fileType}</span></td>
        <td>{drawing.partNos.map(partNo => <span className={`drawing-chip ${drawingKey(partNo) === drawingKey(drawing.drawingNo) ? '' : 'is-alias'}`} key={partNo}>{partNo}</span>)}</td>
        <td>{drawing.docNo || '—'}</td>
        <td>{drawing.note || '—'}</td>
        <td className="drawing-actions">
          {isOpenableUrl(drawing.url)
            ? <a className="drawing-open" href={drawing.url} target="_blank" rel="noreferrer">開く</a>
            : <span className="drawing-open is-disabled" title="http/https以外のリンクはブラウザーから開けません">開く</span>}
          <button type="button" onClick={() => void copyUrl(drawing.url)}>リンクコピー</button>
          <button type="button" onClick={() => edit(drawing)}>編集</button>
          <button type="button" onClick={() => { if (confirm(`${drawing.drawingNo} の図面リンクを削除しますか？`)) onChange(removeDrawing(drawings, drawing.id)); }}>削除</button>
        </td>
      </tr>)}</tbody>
    </table></div> : <p className="drawings-empty">{drawings.length ? '検索条件に一致する図面リンクはありません。' : '図面リンクはまだ登録されていません。社内システムでリンクをコピーして取り込んでください。'}</p>}
  </section>;
}
