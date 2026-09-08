import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  DRAWING_CATEGORIES,
  buildDrawingLink,
  detectDrawingCategory,
  drawingCategoryOf,
  drawingKey,
  findExistingDrawing,
  isAutoRegisterEnabled,
  isOpenableUrl,
  mergePartNos,
  normalizeDrawingNo,
  parseDrawingClipboard,
  parseDrawingClipboardAll,
  partNoFromDrawingNo,
  registerDrawings,
  removeDrawing,
  setAutoRegisterEnabled,
  searchDrawings,
  sortDrawings,
  upsertDrawing,
  type DrawingLink,
  type ParsedDrawing,
} from './drawings';

type Props = {
  drawings: DrawingLink[];
  onChange: (drawings: DrawingLink[]) => void;
  /** 登録済みPLの品番。対象品番の入力候補として使う。 */
  knownPartNos: string[];
  /** 他の画面から引き継いだ取り込み文字列。確認が必要なリンクを受け取る。 */
  intakeText?: string;
  onIntakeHandled?: () => void;
};

type Draft = Omit<DrawingLink, 'updatedAt'> & { isNew: boolean };

const FILE_TYPES = ['PDF', 'DXF', 'EASM', 'DWG', 'TIFF', 'その他'];

/** 今回の取り込みで登録・更新した図面。まとめて貼り付けたときの控えとして表示する。 */
type Registered = { id: string; label: string; status: '登録' | '更新' };

const emptyDraft = (): Draft => ({
  id: crypto.randomUUID(), drawingNo: '', docNo: '', fileType: 'PDF', category: '', fileName: '', url: '', partNos: [], note: '', isNew: true,
});

function exportDrawings(drawings: DrawingLink[]) {
  const rows = sortDrawings(drawings).map(drawing => ({
    図番: normalizeDrawingNo(drawing.drawingNo),
    区分: drawingCategoryOf(drawing),
    種別: drawing.fileType,
    対象品番: drawing.partNos.map(normalizeDrawingNo).join(' / '),
    管理番号: drawing.docNo,
    ファイル名: drawing.fileName,
    リンク: drawing.url,
    備考: drawing.note,
    更新日時: drawing.updatedAt.slice(0, 19).replace('T', ' '),
  }));
  const sheet = XLSX.utils.json_to_sheet(rows, { header: ['図番', '区分', '種別', '対象品番', '管理番号', 'ファイル名', 'リンク', '備考', '更新日時'] });
  sheet['!cols'] = [{ wch: 16 }, { wch: 9 }, { wch: 8 }, { wch: 30 }, { wch: 12 }, { wch: 28 }, { wch: 60 }, { wch: 24 }, { wch: 20 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '図面リンク');
  XLSX.writeFile(workbook, '図面リンク一覧.xlsx');
}

export default function DrawingsView({ drawings, onChange, knownPartNos, intakeText, onIntakeHandled }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [partNoInput, setPartNoInput] = useState('');
  const [pasted, setPasted] = useState('');
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [recent, setRecent] = useState<Registered[]>([]);
  const [autoRegister, setAutoRegister] = useState(isAutoRegisterEnabled);

  const listed = useMemo(() => sortDrawings(searchDrawings(drawings, search)), [drawings, search]);
  const partNoOptions = useMemo(() => [...new Set(knownPartNos.filter(partNo => partNo && partNo !== '+'))].sort(), [knownPartNos]);

  const changeAutoRegister = (value: boolean) => {
    setAutoRegister(value);
    setAutoRegisterEnabled(value);
  };

  /**
   * 取り込んだリンクを下書きへ入れる。図番と品番は一致しないことがあるため、
   * 対象品番は初期値を入れたうえで、利用者が自由に足し引きできるようにする。
   */
  const startDraft = (parsed: ParsedDrawing) => {
    const existing = findExistingDrawing(drawings, parsed);
    const entry = buildDrawingLink(parsed, existing);
    setDraft({ ...entry, isNew: !existing });
  };

  /**
   * 貼り付けやクリップボード取得の入口。図番・リンク・対象品番がそろったものは
   * そのまま登録し、判定できなかったものだけ下書きへ出す。複数のリンクをまとめて
   * 貼り付けた場合は、その全件を順に処理する。
   */
  const intake = (text: string, options: { force?: boolean } = {}) => {
    const parsedList = parseDrawingClipboardAll(text, partNoOptions);
    if (!parsedList.length) {
      setError('リンク（http/https）が見つかりません。社内システムで図面・3Dモデルのリンクをコピーしてください。');
      return false;
    }
    setError('');
    setMessage('');
    // 「クリップボードから取得」は押した時点で登録する操作なので、貼り付け時の
    // 自動登録の設定に関わらず、そのまま登録する。
    if (!autoRegister && !options.force) {
      startDraft(parsedList[0]);
      if (parsedList.length > 1) setError(`自動登録が無効のため、${parsedList.length}件のうち先頭の1件だけを読み込みました。`);
      return true;
    }
    const { next, done, pending } = registerDrawings(drawings, text, partNoOptions);
    if (done.length) {
      onChange(next);
      const registered: Registered[] = done.map(({ drawing, isNew }) => ({
        id: drawing.id,
        label: `${normalizeDrawingNo(drawing.drawingNo)}（${drawingCategoryOf(drawing) || '区分なし'}・${drawing.fileType}）`,
        status: isNew ? '登録' : '更新',
      }));
      setRecent(current => [...registered, ...current].slice(0, 20));
      const added = done.filter(item => item.isNew).length;
      setMessage(`${done.length}件を自動登録しました（新規 ${added}件 / 更新 ${done.length - added}件）。`);
      setPasted('');
    }
    if (pending.length) {
      startDraft(pending[0]);
      setError(`${pending.length}件は図番を判定できませんでした。内容を確認して登録してください。`);
    }
    return true;
  };

  // マトリックス部品表から引き継いだ取り込みを、この画面で処理する。
  useEffect(() => {
    if (!intakeText?.trim()) return;
    intake(intakeText);
    onIntakeHandled?.();
    // 引き継ぎは受け取ったときだけ処理する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intakeText]);

  const captureFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      intake(text, { force: true });
    } catch {
      setError('クリップボードを読み取れませんでした。下の入力欄へ貼り付け（Ctrl+V）してください。');
    }
  };

  const changePasted = (text: string) => {
    setPasted(text);
    if (text.trim()) intake(text);
  };

  // 画面のどこで貼り付けても取り込めるようにする。入力欄の編集中と、下書きを
  // 直している最中は横取りしない。
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (draft) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const text = event.clipboardData?.getData('text') ?? '';
      if (!text.trim()) return;
      event.preventDefault();
      intake(text);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  });

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
      drawingNo: normalizeDrawingNo(draft.drawingNo),
      docNo: draft.docNo.trim(),
      fileType: draft.fileType.trim() || 'その他',
      category: draft.category?.trim() || '',
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
          <p>社内システムの品番マスタで、図面（PDF・DXF）や3Dモデル（eDrawings の EASM）のリンクをコピーし、「クリップボードから取得」を押すか、この画面で貼り付け（Ctrl+V）します。図番・種別・区分・対象品番を自動判定し、そろっていればボタンを押さずにそのまま登録します。複数のリンクをまとめて貼り付けても、全件を続けて登録できます。</p>
        </div>
        <div className="drawings-capture-actions">
          <button className="primary" type="button" onClick={() => void captureFromClipboard()}>クリップボードから取得</button>
          <button type="button" onClick={() => { setDraft(emptyDraft()); setPartNoInput(''); setError(''); setMessage(''); }}>手入力で追加</button>
        </div>
      </div>
      <label className="drawings-auto-toggle">
        <input type="checkbox" checked={autoRegister} onChange={event => changeAutoRegister(event.target.checked)} />
        <span>貼り付けたときも自動で登録する<small>オフにすると、貼り付けた分は確認用の入力欄へ出します。「クリップボードから取得」ボタンは、この設定に関わらずそのまま登録します。</small></span>
      </label>
      <textarea
        className="drawings-paste"
        aria-label="図面リンクを貼り付け"
        placeholder="ここへ貼り付け（Ctrl+V）すると取り込みます。1行に1つずつ、複数のリンクをまとめて貼り付けられます。"
        value={pasted}
        onChange={event => changePasted(event.target.value)}
      />
    </div>

    {error && <div className="error">⚠ {error}<button type="button" onClick={() => setError('')}>×</button></div>}
    {message && <div className="drawings-message">{message}</div>}
    {recent.length > 0 && <div className="drawings-recent">
      <div className="drawings-recent-head"><b>今回の取り込み</b><button type="button" onClick={() => setRecent([])}>表示を消す</button></div>
      <ul>{recent.map((item, index) => <li key={`${item.id}-${index}`}>
        <span className={`drawing-status ${item.status === '登録' ? 'added' : 'updated'}`}>{item.status}</span>
        <span>{item.label}</span>
        <button type="button" onClick={() => { const found = drawings.find(drawing => drawing.id === item.id); if (found) edit(found); }}>編集</button>
      </li>)}</ul>
    </div>}

    {draft && <form className="drawing-form" onSubmit={event => { event.preventDefault(); save(); }}>
      <h3>{draft.isNew ? '図面リンクを登録' : '図面リンクを編集'}</h3>
      <div className="drawing-form-grid">
        <label><span>図番</span><input value={draft.drawingNo} placeholder="必須" onChange={event => setDraft({ ...draft, drawingNo: event.target.value })} /></label>
        <label><span>種別</span><select value={draft.fileType} onChange={event => setDraft({ ...draft, fileType: event.target.value })}>{[...new Set([draft.fileType, ...FILE_TYPES])].filter(Boolean).map(type => <option key={type} value={type}>{type}</option>)}</select></label>
        <label><span>区分</span><select value={draft.category?.trim() || detectDrawingCategory(draft.drawingNo)} onChange={event => setDraft({ ...draft, category: event.target.value })}><option value="">未設定</option>{DRAWING_CATEGORIES.map(category => <option key={category} value={category}>{category}</option>)}</select></label>
        <label><span>管理番号</span><input value={draft.docNo} placeholder="自動取得" onChange={event => setDraft({ ...draft, docNo: event.target.value })} /></label>
        <label className="drawing-form-wide"><span>リンク</span><input value={draft.url} placeholder="https://..." onChange={event => {
          const url = event.target.value;
          // 手入力でリンクを差し替えたときも、空欄の項目だけは自動判定を補う。
          const parsed = parseDrawingClipboard(url, partNoOptions);
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
            <button type="button" onClick={() => addPartNos(partNoFromDrawingNo(draft.drawingNo, partNoOptions))} disabled={!partNoFromDrawingNo(draft.drawingNo, partNoOptions)} title="11桁の図番から、対応する10桁の品番を追加します">図番から品番</button>
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
      <button className="excel" type="button" onClick={() => exportDrawings(drawings)} disabled={!drawings.length}>Excel出力</button>
    </div>

    {listed.length ? <div className="drawings-table"><table>
      <thead><tr><th>図番</th><th>区分</th><th>種別</th><th>対象品番</th><th>管理番号</th><th>備考</th><th>操作</th></tr></thead>
      <tbody>{listed.map(drawing => <tr key={drawing.id}>
        <td><b>{normalizeDrawingNo(drawing.drawingNo)}</b><small>{drawing.fileName}</small></td>
        <td>{drawingCategoryOf(drawing) ? <span className={`drawing-category ${drawingCategoryOf(drawing) === '組立図' ? 'assembly' : 'part'}`}>{drawingCategoryOf(drawing)}</span> : '—'}</td>
        <td><span className={`drawing-type ${drawing.fileType.toLowerCase()}`}>{drawing.fileType}</span></td>
        <td>{drawing.partNos.map(partNo => <span className={`drawing-chip ${normalizeDrawingNo(partNo) === normalizeDrawingNo(drawing.drawingNo) ? '' : 'is-alias'}`} key={partNo}>{normalizeDrawingNo(partNo)}</span>)}</td>
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
