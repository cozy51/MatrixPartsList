import { useMemo, useState } from 'react';
import {
  cadIdFor,
  drawingKey,
  isPlNumber,
  removeCadId,
  sortCadIds,
  upsertCadId,
  type CadIdLink,
  type DrawingLink,
} from './drawings';

type Props = {
  cadIds: CadIdLink[];
  onChange: (cadIds: CadIdLink[]) => void;
  /** 図面リンク。CAD IDから流用できる図面があるかの確認に使う。 */
  drawings: DrawingLink[];
  /** 登録済みPLの品番。入力候補に使う。 */
  knownPartNos: string[];
};

/**
 * CAD IDは、材質違いなど見た目が変わらない場合に図面を流用するための対応表です。
 * 図面リンクとは件数の桁が違うため、独立したタブにしてスクロールを減らしています。
 */
export default function CadIdView({ cadIds, onChange, drawings, knownPartNos }: Props) {
  const [partNo, setPartNo] = useState('');
  const [target, setTarget] = useState('');
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const partNoOptions = useMemo(() => [...new Set(knownPartNos.filter(no => no && no !== '+'))].sort(), [knownPartNos]);
  const plNoOptions = useMemo(() => partNoOptions.filter(isPlNumber), [partNoOptions]);
  const listed = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const sorted = sortCadIds(cadIds);
    return needle ? sorted.filter(item => `${item.partNo} ${item.cadId}`.toLowerCase().includes(needle)) : sorted;
  }, [cadIds, search]);

  const drawingsOf = (cadId: string) =>
    drawings.filter(drawing => drawing.partNos.some(no => drawingKey(no) === drawingKey(cadId)));

  /** 入力の状態。ボタンを押せるかどうかを、その場で見て分かるようにする。 */
  const from = partNo.trim().toUpperCase();
  const to = target.trim().toUpperCase();
  const invalidPl = Boolean(from) && !isPlNumber(from);
  const sameNo = Boolean(from && to) && drawingKey(from) === drawingKey(to);
  const ready = Boolean(from && to) && !invalidPl && !sameNo;
  const hint = invalidPl ? 'CAD IDを登録できるのはPL（10桁目が1）の番号だけです。'
    : sameNo ? 'PL番号とCAD IDが同じです。'
    : ready ? `${from} の図面を ${to} から流用します。`
    : 'PL番号とCAD IDを入力してください。';

  const save = () => {
    if (!from || !to) { setError('PL番号とCAD IDを入力してください。'); return; }
    if (!isPlNumber(from)) { setError('CAD IDを登録できるのはPL（10桁目が1）の番号だけです。'); return; }
    if (drawingKey(from) === drawingKey(to)) { setError('PL番号とCAD IDが同じです。'); return; }
    onChange(upsertCadId(cadIds, { partNo: from, cadId: to, updatedAt: new Date().toISOString() }));
    setPartNo('');
    setTarget('');
    setError('');
    setMessage(`${from} のCAD IDに ${to} を登録しました。${drawingsOf(to).length ? '' : ' CAD ID側の図面はまだ登録されていません。'}`);
  };

  return <section className="cadid-view">
    <div className="cadid-heading">
      <div>
        <h2>CAD ID（図面の流用）</h2>
        <p>材質違いなど見た目が変わらない場合に、PLの図面をCAD IDの品番から流用します。登録できるのはPL（10桁目が1）の番号だけです。流用した図面は、部品表で破線と <code>CAD</code> の印が付きます。</p>
      </div>
      <strong>{cadIds.length}<span> 件</span></strong>
    </div>

    <form className={`cadid-form ${ready ? 'is-ready' : ''}`} onSubmit={event => { event.preventDefault(); save(); }}>
      <label><span>PL番号</span><input className={from ? (invalidPl ? 'is-invalid' : 'is-ok') : ''} list="cadid-pl-options" value={partNo} placeholder="例: HH11002010" onChange={event => setPartNo(event.target.value)} /></label>
      <span className="cadid-arrow" aria-hidden="true">→</span>
      <label><span>CAD ID</span><input className={to ? (sameNo ? 'is-invalid' : 'is-ok') : ''} list="cadid-part-options" value={target} placeholder="図面を持つ品番" onChange={event => setTarget(event.target.value)} /></label>
      <button className="primary" type="submit" disabled={!ready}>{ready ? '✓ CAD IDを登録' : 'CAD IDを登録'}</button>
      <p className={`cadid-hint ${ready ? 'is-ready' : invalidPl || sameNo ? 'is-invalid' : ''}`}>{hint}</p>
      <datalist id="cadid-pl-options">{plNoOptions.map(no => <option key={no} value={no} />)}</datalist>
      <datalist id="cadid-part-options">{partNoOptions.map(no => <option key={no} value={no} />)}</datalist>
    </form>

    {error && <div className="error">⚠ {error}<button type="button" onClick={() => setError('')}>×</button></div>}
    {message && <div className="drawings-message">{message}</div>}

    <div className="drawings-list-head">
      <div><h3>登録済みCAD ID</h3><p>1つのPLにつき1件です。登録し直すと上書きします。</p></div>
      <label className="search-box"><span aria-hidden="true">🔍</span><input className="search" aria-label="PL番号・CAD IDで検索" placeholder="PL番号・CAD IDを検索..." value={search} onChange={event => setSearch(event.target.value)} /></label>
    </div>

    {listed.length ? <div className="drawings-table cadid-table"><table>
      <thead><tr><th>PL番号</th><th>CAD ID</th><th>流用できる図面</th><th>操作</th></tr></thead>
      <tbody>{listed.map(item => {
        const borrowed = drawingsOf(item.cadId);
        return <tr key={item.partNo}>
          <td><b>{item.partNo}</b></td>
          <td><span className="drawing-chip is-cadid">CAD ID {item.cadId}</span></td>
          <td>{borrowed.length
            ? borrowed.map(drawing => <span className={`drawing-type ${drawing.fileType.toLowerCase()}`} key={drawing.id}>{drawing.fileType}</span>)
            : <span className="cadid-missing">CAD IDの図面が未登録です</span>}</td>
          <td className="drawing-actions">
            <button type="button" onClick={() => { setPartNo(item.partNo); setTarget(item.cadId); setError(''); setMessage(''); }}>編集</button>
            <button type="button" onClick={() => { if (confirm(`${item.partNo} のCAD ID（${item.cadId}）を削除しますか？`)) onChange(removeCadId(cadIds, item.partNo)); }}>削除</button>
          </td>
        </tr>;
      })}</tbody>
    </table></div> : <p className="drawings-empty">{cadIds.length ? '検索条件に一致するCAD IDはありません。' : 'CAD IDはまだ登録されていません。'}</p>}

    {cadIds.length > 0 && <p className="cadid-note">登録済みのPLで、CAD IDを設定していないものは <b>{plNoOptions.filter(no => !cadIdFor(cadIds, no)).length}</b> 件です。</p>}
  </section>;
}
