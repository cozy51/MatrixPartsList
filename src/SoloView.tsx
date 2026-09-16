import { useMemo, useState, type ReactNode } from 'react';
import * as XLSX from 'xlsx';
import { normalizePlVersion, plLabel } from './csv';
import { countParts, excludeNoteParts, isPurchasedPart, isSupplementPart, plKindLabel, sortPartsByBalloon } from './matrix';
import { emptyPartFact, formatAmount, parseAmount, partFactFor, upsertPartFact, type PartFact } from './drawings';
import type { Part, PartsList } from './types';

type Props = {
  /** 単独部品表に出すPL。左の一覧で枠を付けて選んだ1つ。 */
  list: PartsList | undefined;
  /** 選べるPL（今の機種・ユニットに登録されているすべて）。表示チェックとは関係なく選べる。 */
  lists: PartsList[];
  /** 左の一覧・マトリックス部品表と共通の連番。 */
  sequence: Map<string, number>;
  onSelect: (id: string) => void;
  /** 品番ごとの質量・価格・`.shai`。 */
  facts: PartFact[];
  onFactsChange: (facts: PartFact[]) => void;
  /** 品番に紐づく図面・3Dモデルの印。マトリックス部品表と同じものを使う。 */
  renderBadges: (partNo: string) => ReactNode;
};

type Row = {
  part: Part;
  /** 入力済みの単品質量。空のときはCSVの単品質量をそのまま使う。 */
  mass: string;
  price: string;
  shaiUrl: string;
  /** 合計＝単品質量・単価 × 数量。どれかが数として読めないときは undefined。 */
  totalMass: number | undefined;
  totalPrice: number | undefined;
};

const COLUMNS = ['風船', '品番', 'Ver.', '品名', '数量', '材質・メーカー', '単品質量（kg）', '合計質量（kg）', '単価（円）', '金額（円）', 'Shaiファイル'];

/** 合計は、数として読めた行だけを足す。未入力の行を0として足すと合計を見誤るため。 */
const sumRows = (rows: Row[], pick: (row: Row) => number | undefined) => {
  let total = 0, counted = 0;
  for (const row of rows) {
    const value = pick(row);
    if (value === undefined) continue;
    total += value;
    counted += 1;
  }
  return { total, counted };
};

/**
 * 単独部品表は、PLを1つだけ選んで明細をそのまま確認・編集する画面です。
 * マトリックス部品表が複数PLの比較に使う幅を、ここでは質量・価格・chemSHERPA
 * （`.shai`）の列に充てています。質量・価格・`.shai` は**品番ごと**に持つため、
 * どのPLから入力しても同じ品番なら同じ値を表示します。
 */
export default function SoloView({ list, lists, sequence, onSelect, facts, onFactsChange, renderBadges }: Props) {
  const [search, setSearch] = useState('');
  /* 1つのセルを編集している間だけ下書きを持つ。入力のたびに保存すると同期の
     リビジョンが上がり続けるため、確定（フォーカスを外す・Enter）で書き込む。 */
  const [draft, setDraft] = useState<{ partNo: string; field: 'mass' | 'price'; value: string } | null>(null);
  const [shaiDraft, setShaiDraft] = useState<{ partNo: string; value: string; error: string } | null>(null);

  /* 明細の並びはマトリックス部品表と同じ。注記行（風船C）は除く。 */
  const parts = useMemo(() => sortPartsByBalloon(excludeNoteParts(list?.parts ?? [])), [list]);
  const rows = useMemo<Row[]>(() => parts.map(part => {
    const fact = partFactFor(facts, part.partNo);
    /* 補材（`+`）は品番で見分けられないため、品番ごとの値は持たせない。 */
    const supplement = isSupplementPart(part.partNo);
    const mass = supplement ? '' : fact?.mass || part.unitMass || '';
    const price = supplement ? '' : fact?.price ?? '';
    const quantity = parseAmount(part.quantity);
    const massValue = parseAmount(mass), priceValue = parseAmount(price);
    return {
      part,
      mass: supplement ? '' : fact?.mass ?? '',
      price,
      shaiUrl: supplement ? '' : fact?.shaiUrl ?? '',
      totalMass: massValue !== undefined && quantity !== undefined ? massValue * quantity : undefined,
      totalPrice: priceValue !== undefined && quantity !== undefined ? priceValue * quantity : undefined,
    };
  }), [parts, facts]);
  const listed = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(row => `${row.part.partNo} ${row.part.name} ${row.part.material} ${row.part.balloon}`.toLowerCase().includes(needle));
  }, [rows, search]);

  const massTotal = useMemo(() => sumRows(listed, row => row.totalMass), [listed]);
  const priceTotal = useMemo(() => sumRows(listed, row => row.totalPrice), [listed]);

  const saveFact = (partNo: string, field: 'mass' | 'price' | 'shaiUrl', value: string) => {
    const base = partFactFor(facts, partNo) ?? emptyPartFact(partNo);
    if (base[field] === value.trim()) return;
    const next: PartFact = { ...base, partNo, updatedAt: new Date().toISOString() };
    if (field === 'mass') next.mass = value;
    else if (field === 'price') next.price = value;
    else next.shaiUrl = value;
    onFactsChange(upsertPartFact(facts, next));
  };
  const commitDraft = () => {
    if (draft) saveFact(draft.partNo, draft.field, draft.value);
    setDraft(null);
  };
  const saveShaiDraft = () => {
    if (!shaiDraft) return;
    const value = shaiDraft.value.trim();
    if (value && !/^https?:\/\//i.test(value)) {
      setShaiDraft({ ...shaiDraft, error: 'http:// または https:// で始まるリンクを入力してください。' });
      return;
    }
    saveFact(shaiDraft.partNo, 'shaiUrl', value);
    setShaiDraft(null);
  };

  /** 入力欄。CSVの単品質量は、上書きしていないことが分かるよう薄い文字の目安として出す。 */
  const amountCell = (row: Row, field: 'mass' | 'price') => {
    const partNo = row.part.partNo;
    if (isSupplementPart(partNo)) return <span className="solo-blank" title="補材は品番で見分けられないため、質量・価格を持ちません。">—</span>;
    const editing = draft?.partNo === partNo && draft.field === field;
    const stored = field === 'mass' ? row.mass : row.price;
    const placeholder = field === 'mass' ? (row.part.unitMass ?? '').trim() : '';
    return <input
      className={`solo-amount ${!stored && placeholder ? 'is-inherited' : ''}`}
      type="text" inputMode="decimal"
      aria-label={`${partNo} の${field === 'mass' ? '単品質量（kg）' : '単価（円）'}`}
      title={field === 'mass' && placeholder ? `CSV・Excelの単品質量は ${placeholder} kg です。空欄のままならこの値を使います。` : undefined}
      placeholder={placeholder || '—'}
      value={editing ? draft.value : stored}
      onChange={event => setDraft({ partNo, field, value: event.target.value })}
      onBlur={commitDraft}
      onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') setDraft(null); }}
    />;
  };

  const shaiCell = (row: Row) => {
    const partNo = row.part.partNo;
    if (isSupplementPart(partNo)) return <span className="solo-blank">—</span>;
    return <span className="solo-shai">
      {row.shaiUrl && <a className="shai-link" href={row.shaiUrl} target="_blank" rel="noreferrer" title={`${partNo} のchemSHERPA（.shai）ファイルを開く`}>.shai</a>}
      <button type="button" className={`shai-edit ${row.shaiUrl ? '' : 'is-empty'}`} title={`${partNo} のchemSHERPA（.shai）ファイルのリンクを${row.shaiUrl ? '変更・解除' : '登録'}`}
        onClick={() => setShaiDraft({ partNo, value: row.shaiUrl, error: '' })}>{row.shaiUrl ? '変更' : '＋ 登録'}</button>
    </span>;
  };

  const exportExcel = () => {
    if (!list) return;
    const aoa = [
      COLUMNS,
      ...listed.map(row => [
        row.part.balloon, row.part.partNo, row.part.version, row.part.name, row.part.quantity, row.part.material,
        row.mass || row.part.unitMass || '', row.totalMass ?? '', row.price, row.totalPrice ?? '', row.shaiUrl,
      ]),
      ['', '', '', '', '', '合計', '', massTotal.total || '', '', priceTotal.total || '', ''],
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(aoa), '単独部品表');
    XLSX.writeFile(workbook, `単独部品表_${`${list.plNo}_v${normalizePlVersion(list.plVersion) || '-'}`.replace(/[\\/:*?"<>|]/g, '_')}.xlsx`);
  };

  return <section className="solo-view">
    <div className="solo-head">
      <label className="solo-picker"><span>単独表示するPL</span>
        <select value={list?.id ?? ''} onChange={event => onSelect(event.target.value)}>
          {!list && <option value="">選択してください</option>}
          {lists.map(item => <option key={item.id} value={item.id}>{`${sequence.get(item.id) ?? '-'}. ${plLabel(item)}｜${item.plName || item.fileName}`}</option>)}
        </select>
      </label>
      <label className="search-box"><span aria-hidden="true">🔍</span>
        <input className="search" aria-label="部品を検索" placeholder="品番・品名・材質を検索..." value={search} onChange={event => setSearch(event.target.value)} />
      </label>
      <button type="button" className="excel" onClick={exportExcel} disabled={!list}>Excel出力</button>
    </div>

    {list ? <>
      <div className="solo-summary">
        <div>
          <h3>{list.plNo}{renderBadges(list.plNo)}</h3>
          <p>{list.plName || list.fileName}</p>
          <small>{plKindLabel(list.plNo) ? `${plKindLabel(list.plNo)} ・ ` : ''}Ver.{normalizePlVersion(list.plVersion) || '-'} ・ {countParts(list.parts)} 部品{search.trim() && ` ・ 検索一致 ${listed.length} 部品`}</small>
        </div>
        <dl className="solo-totals">
          <div><dt>合計質量</dt><dd>{massTotal.counted ? `${formatAmount(massTotal.total)} kg` : '—'}<small>{massTotal.counted} / {listed.length} 部品</small></dd></div>
          <div><dt>合計金額</dt><dd>{priceTotal.counted ? `${formatAmount(priceTotal.total, 0)} 円` : '—'}<small>{priceTotal.counted} / {listed.length} 部品</small></dd></div>
        </dl>
      </div>

      <p className="solo-note">
        質量・価格・chemSHERPA（<code>.shai</code>）は<b>品番ごと</b>に保存します。どのPLから入れても、同じ品番なら同じ値を表示します。
        単品質量は、CSV・Excelから読み込んだ値を薄い文字で出しています。<b>空欄のままならその値</b>を使い、入力すると入力した値で上書きします。
      </p>

      {listed.length ? <div className="solo-table"><table>
        <colgroup>
          <col className="solo-balloon" /><col className="solo-part-no" /><col className="solo-version" /><col className="solo-name" /><col className="solo-quantity" /><col className="solo-material" />
          <col className="solo-mass" /><col className="solo-total-mass" /><col className="solo-price" /><col className="solo-total-price" /><col className="solo-shai-col" />
        </colgroup>
        <thead><tr>{COLUMNS.map(label => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{listed.map((row, index) => <tr key={`${row.part.balloon}-${row.part.partNo}-${row.part.version}-${index}`}>
          <td>{row.part.balloon}</td>
          <td className={isPurchasedPart(row.part.partNo) ? 'purchased-part' : undefined}>{row.part.partNo}{renderBadges(row.part.partNo)}</td>
          <td>{row.part.version}</td>
          <td title={row.part.name}>{row.part.name}</td>
          <td>{row.part.quantity}</td>
          <td title={row.part.material}>{row.part.material}</td>
          <td>{amountCell(row, 'mass')}</td>
          <td className="solo-calc">{row.totalMass === undefined ? '—' : formatAmount(row.totalMass)}</td>
          <td>{amountCell(row, 'price')}</td>
          <td className="solo-calc">{row.totalPrice === undefined ? '—' : formatAmount(row.totalPrice, 0)}</td>
          <td>{shaiCell(row)}</td>
        </tr>)}</tbody>
        <tfoot><tr>
          <td colSpan={6}>合計（表示中 {listed.length} 部品）</td>
          <td />
          <td className="solo-calc">{massTotal.counted ? formatAmount(massTotal.total) : '—'}</td>
          <td />
          <td className="solo-calc">{priceTotal.counted ? formatAmount(priceTotal.total, 0) : '—'}</td>
          <td />
        </tr></tfoot>
      </table></div> : <p className="drawings-empty">{rows.length ? '検索条件に一致する部品はありません。' : 'このPLに部品がありません。'}</p>}
    </> : <p className="drawings-empty">
      単独部品表に出すPLがありません。左の一覧でPLをクリックすると、そのPLを枠で囲んでここに表示します（表示チェックとは別に選べます）。
    </p>}

    {shaiDraft && <div className="modal-bg" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setShaiDraft(null); }}>
      <div className="modal shai-modal" role="dialog" aria-modal="true" aria-labelledby="shai-modal-title">
        <h2 id="shai-modal-title">chemSHERPA（.shai）ファイルのリンク</h2>
        <p><b>{shaiDraft.partNo}</b> のchemSHERPAファイルを、共有リンクで登録します。</p>
        <label className="model-input"><span>ファイルのリンク</span>
          <input autoFocus value={shaiDraft.value} placeholder="https://..." onChange={event => setShaiDraft({ ...shaiDraft, value: event.target.value, error: '' })}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); saveShaiDraft(); } }} />
        </label>
        {shaiDraft.error && <div className="model-message">{shaiDraft.error}</div>}
        <small className="model-note">Google Drive・SharePointなど、ブラウザーで開ける共有リンクをそのまま貼り付けてください。リンクは品番ごとに1件保存します。</small>
        <div className="modal-actions">
          {partFactFor(facts, shaiDraft.partNo)?.shaiUrl && <button type="button" className="model-clear" onClick={() => { saveFact(shaiDraft.partNo, 'shaiUrl', ''); setShaiDraft(null); }}>登録を解除</button>}
          <button type="button" onClick={() => setShaiDraft(null)}>キャンセル</button>
          <button type="button" className="primary" onClick={saveShaiDraft}>保存</button>
        </div>
      </div>
    </div>}
  </section>;
}
