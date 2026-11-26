import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { displayMass, displayPrice, emptyPartFact, formatAmount, normalizeMassInput, partFactFor, upsertPartFact, type PartFact, type PartFile } from './drawings';
import { isPurchasedPart, isSupplementPart } from './matrix';
import { isLevel40No } from './levels';
import { BOM_COLUMNS, EMPTY_BOM_FILTER, MASS_COLUMN, PRICE_COLUMN, isBomFilterActive, sumBomRows, type BomFilter, type BomRow } from './bom';
import { partKey } from './csv';
import { UNITBASE_NOTE_COLUMN, UNITBASE_STATUS_COLUMN } from './unitbase';
import type { PartsList } from './types';

/** 40レベル部品の中身を開くための入口。マトリックスBOM・単体BOMで同じものを使う。 */
export type Level40Access = {
  /** 明細のVer.と一致する登録を返す。Ver.が違う・未登録のときは undefined。 */
  find: (partNo: string, version: string) => PartsList | undefined;
  /** 同じ番号で登録されている他のVer.（`v01・v02`）。開けない理由の注記に使う。 */
  otherVersions: (partNo: string) => string;
  open: (list: PartsList) => void;
};

type Props = {
  rows: BomRow[];
  facts: PartFact[];
  onFactsChange: (facts: PartFact[]) => void;
  /** 品番に紐づく図面・3Dモデルの印。マトリックスBOMと同じものを使う。 */
  renderBadges: (partNo: string) => ReactNode;
  level40: Level40Access;
  /** 合計行に添える説明（「合計（表示中 12 部品）」など）。 */
  totalLabel: string;
  /** 列ごとの絞り込み。渡したときだけ見出しの下に入力欄の行を出す（単体BOMのタブ）。 */
  filter?: BomFilterAccess;
};

export type BomFilterAccess = {
  value: BomFilter;
  onChange: (filter: BomFilter) => void;
  /** chemSHERPA調査状況の選択肢。絞り込む前の全行から作る。 */
  chemOptions: { value: string; label: string; count: number }[];
  /** 品番の階層（9桁目）の選択肢。件数はほかの絞り込みを満たす行で数える。 */
  levelOptions: { value: string; label: string; count: number }[];
};


/**
 * 部品明細に、質量・価格・chemSHERPA（`.shai`）の列を加えた表です。
 * 単体BOMのタブと、40レベル部品の中身のポップアップで**同じ表**を使います。
 * 40レベル部品の質量・単価は中身（50/60レベル）の合計で決まるため、その行は
 * 入力欄にせず、計算した値と内訳の注記を出します。
 */
export default function BomTable({ rows, facts, onFactsChange, renderBadges, level40, totalLabel, filter }: Props) {
  /* 1つのセルを編集している間だけ下書きを持つ。入力のたびに保存すると同期の
     リビジョンが上がり続けるため、確定（フォーカスを外す・Enter）で書き込む。 */
  const [draft, setDraft] = useState<{ partNo: string; field: 'mass' | 'price'; value: string } | null>(null);
  const [shaiDraft, setShaiDraft] = useState<{ partNo: string; value: string; error: string } | null>(null);
  /* その他ファイルは複数件をまとめて編集し、「保存」でまとめて書き込む。 */
  const [filesDraft, setFilesDraft] = useState<{ partNo: string; files: PartFile[]; error: string } | null>(null);
  /* 質量と単価は見た目が似ていて取り違えやすいため、初めは編集できない状態にし、
     見出しの鍵ボタンで列ごとに切り替える。同じ画面でも別々に開け閉めできる。 */
  const [unlocked, setUnlocked] = useState<{ mass: boolean; price: boolean }>({ mass: false, price: false });
  /* 明細は100行を超えることもあり、上から順に見ていくと「どこまで見たか」を見失いやすい。
     クリックした行に目印を残し、図面を開いて戻ってきても続きから始められるようにする。
     カーソルの色と違って動かないため、行の位置を覚えておく用途にはこちらを使う。 */
  const [pickedKey, setPickedKey] = useState('');
  const pickRow = (key: string) => (event: MouseEvent<HTMLTableRowElement>) => {
    /* 入力欄・ボタン・リンクを押したときは目印を動かさない（値を入れている最中に
       目印が移ったり消えたりすると、見ていた場所が分からなくなるため）。 */
    if ((event.target as HTMLElement).closest('input, button, a, select, textarea')) return;
    setPickedKey(current => current === key ? '' : key);
  };
  const toggleLock = (field: 'mass' | 'price') => {
    /* 編集中の列を閉じるときは、書きかけの下書きを捨てる（保存はしない）。 */
    if (unlocked[field] && draft?.field === field) setDraft(null);
    setUnlocked(current => ({ ...current, [field]: !current[field] }));
  };

  const massTotal = sumBomRows(rows, row => row.totalMass);
  const priceTotal = sumBomRows(rows, row => row.totalPrice);

  const saveFact = (partNo: string, field: 'mass' | 'price' | 'shaiUrl', value: string) => {
    /* 単品質量は kg で持つため、`8.28g` のようにグラムで入れられたら kg へ直してから保存する。
       比較と保存で値をそろえておく（前後の空白が残ると、毎回違う値として保存され続けるため）。 */
    const input = (field === 'mass' ? normalizeMassInput(value) : value).trim();
    const base = partFactFor(facts, partNo) ?? emptyPartFact(partNo);
    if (base[field] === input) return;
    const next: PartFact = { ...base, partNo, updatedAt: new Date().toISOString() };
    if (field === 'mass') next.mass = input;
    else if (field === 'price') next.price = input;
    else next.shaiUrl = input;
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

  const newFile = (): PartFile => ({ id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, label: '', url: '' });
  const openFilesDraft = (partNo: string, files: PartFile[]) =>
    setFilesDraft({ partNo, files: files.length ? files.map(file => ({ ...file })) : [newFile()], error: '' });
  const changeDraftFile = (id: string, change: Partial<PartFile>) => {
    if (filesDraft) setFilesDraft({ ...filesDraft, error: '', files: filesDraft.files.map(file => file.id === id ? { ...file, ...change } : file) });
  };
  const saveFilesDraft = () => {
    if (!filesDraft) return;
    /* リンクも説明も空の行は、書きかけの空行として捨てる。 */
    const files = filesDraft.files.filter(file => file.url.trim() || file.label.trim());
    if (files.some(file => !/^https?:\/\//i.test(file.url.trim()))) {
      setFilesDraft({ ...filesDraft, error: 'リンクは http:// または https:// で始まるものを入力してください。' });
      return;
    }
    const base = partFactFor(facts, filesDraft.partNo) ?? emptyPartFact(filesDraft.partNo);
    onFactsChange(upsertPartFact(facts, { ...base, partNo: filesDraft.partNo, files, updatedAt: new Date().toISOString() }));
    setFilesDraft(null);
  };

  /** 40レベルは中身を開けるようにする。Ver.が合わないときは、開けない理由を注記で知らせる。 */
  const partNoCell = (row: BomRow) => {
    const { partNo, version } = row.part;
    const content = <span>{partNo}</span>;
    const match = level40.find(partNo, version);
    if (match) return <button type="button" className="level40-open" title={`${partNo} Ver.${version} の40レベル部品の中身（50/60レベル）を開きます`}
      aria-label={`${partNo} Ver.${version} の40レベル部品の中身を開く`} onClick={() => level40.open(match)}>{content}</button>;
    const isLevel40 = isLevel40No(partNo);
    const others = isLevel40 ? level40.otherVersions(partNo) : '';
    if (isLevel40) return <span className="level40-unlinked"
      title={others
        ? `${partNo} のVer.${version || '-'} は登録されていません（登録済み: ${others}）。40レベルはVer.ごとに中身が違うため、同じVer.の明細を読み込むと開けます。`
        : `${partNo} の40レベル部品リストが登録されていません。該当する明細を読み込むと中身を確認できます。`}>{content}</span>;
    return content;
  };

  /**
   * 質量・単価のセル。40レベル部品は中身の合計で決まるため入力欄にしない。
   * それ以外は入力欄にし、CSV・Excelの単品質量は薄い文字の目安として出す。
   * 値が入っていないセルは背景に色を付け、入れ忘れに気づけるようにする。
   * セル全体を塗るため、中身だけでなく `td` ごと組み立てている。
   */
  const amountCell = (row: BomRow, field: 'mass' | 'price') => {
    const partNo = row.part.partNo;
    /* 補材は質量・価格を持たないため、空でも「入れ忘れ」ではない。 */
    if (isSupplementPart(partNo)) return <td><span className="solo-blank" title="補材は品番で見分けられないため、質量・価格を持ちません。">—</span></td>;
    const source = field === 'mass' ? row.massSource : row.priceSource;
    if (source === 'children') {
      const value = field === 'mass' ? row.unitMass : row.unitPrice;
      const summary = row.childSummary;
      const counted = field === 'mass' ? summary?.massCounted ?? 0 : summary?.priceCounted ?? 0;
      const label = field === 'mass' ? '質量' : '単価';
      /* リスト自体が未登録なら、入力不可の「—」だけを出す。中身が登録済みなのに
         値が1件もない場合だけ、「中身の合計（未登録）」で入力漏れを知らせる。 */
      if (!summary) return <td><span className="solo-blank" title="40レベル部品のリストが未登録のため、この欄には入力できません。">—</span></td>;
      const unregistered = value === undefined;
      /* 40レベル部品は中身（50/60レベル）の合計で決まり、この欄には入力できない。
         合計が出せなくても入れ忘れではないため、未入力の色は付けない。 */
      return <td>
        <span className={`bom-derived ${unregistered ? 'is-unregistered' : ''}`} title={unregistered
          ? `中身（${summary.parts} 部品）の${label}が登録されていないため、合計できません。`
          : `40レベル部品のため、中身（${summary.parts} 部品）の合計です。${label}が入っているのは ${counted} 部品です。`}>
          {value === undefined ? '—' : formatAmount(value, field === 'mass' ? 3 : 0)}<i>{unregistered ? '中身の合計（未登録）' : '中身の合計'}</i>
        </span>
      </td>;
    }
    const editing = draft?.partNo === partNo && draft.field === field;
    const stored = field === 'mass' ? row.massInput : row.priceInput;
    const placeholder = field === 'mass' ? row.csvMass : '';
    const columnLabel = field === 'mass' ? MASS_COLUMN : PRICE_COLUMN;
    /* 表の見やすさを優先し、合計の列と同じ丸め方で出す（質量は1g、単価は1円）。
       編集を始めたら丸める前の値に戻すので、0.00828 のような端数が消えることはない。 */
    const display = field === 'mass' ? displayMass : displayPrice;
    const shown = display(stored);
    const editable = unlocked[field];
    /* CSV・Excelの値を引き継いでいる欄（is-inherited）は値があるため、入れ忘れではない。 */
    const missing = !stored && !placeholder;
    return <td className={missing ? 'is-missing' : undefined}><input
      className={`solo-amount ${!stored && placeholder ? 'is-inherited' : ''} ${editable ? '' : 'is-locked'}`}
      type="text" inputMode="decimal" readOnly={!editable}
      aria-label={`${partNo} の${columnLabel}`}
      title={[
        !editable && `${columnLabel}は編集できません。見出しの鍵を押すと編集できます。`,
        field === 'mass' && placeholder && `CSV・Excelの単品質量は ${placeholder} kg です。空欄のままならこの値を使います。`,
        stored && shown !== stored && `入力された値は ${stored} です（表示は${field === 'mass' ? '1g' : '1円'}に四捨五入）。`,
        field === 'mass' && 'g を付けて入力すると kg に直して保存します（8.28g → 0.00828）。',
      ].filter(Boolean).join('') || undefined}
      placeholder={display(placeholder) || '—'}
      value={editing ? draft.value : shown}
      /* 丸めた表示のまま書き換えると端数が落ちるため、編集に入るときは元の値を下書きにする。 */
      onFocus={editable ? () => setDraft({ partNo, field, value: stored }) : undefined}
      onChange={editable ? event => setDraft({ partNo, field, value: event.target.value }) : undefined}
      onBlur={editable ? commitDraft : undefined}
      onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') setDraft({ partNo, field, value: stored }); }}
    /></td>;
  };

  const shaiCell = (row: BomRow) => {
    const partNo = row.part.partNo;
    if (isSupplementPart(partNo)) return <span className="solo-blank">—</span>;
    return <span className="solo-shai">
      {row.shaiUrl && <a className="shai-link" href={row.shaiUrl} target="_blank" rel="noreferrer" title={`${partNo} のchemSHERPA（.shai）ファイルを開く`}>.shai</a>}
      <button type="button" className={`shai-edit ${row.shaiUrl ? '' : 'is-empty'}`} title={`${partNo} のchemSHERPA（.shai）ファイルのリンクを${row.shaiUrl ? '変更・解除' : '登録'}`}
        onClick={() => setShaiDraft({ partNo, value: row.shaiUrl, error: '' })}>{row.shaiUrl ? '変更' : '＋ 登録'}</button>
    </span>;
  };

  const filesCell = (row: BomRow) => {
    const partNo = row.part.partNo;
    if (isSupplementPart(partNo)) return <span className="solo-blank">—</span>;
    return <span className="part-files">
      {row.files.map(file => <a key={file.id} className="part-file-link" href={file.url} target="_blank" rel="noreferrer"
        title={`${partNo} の${file.label || 'ファイル'}を開く`}>{file.label || 'ファイル'}</a>)}
      <button type="button" className={`shai-edit ${row.files.length ? '' : 'is-empty'}`} title={`${partNo} のその他ファイルを${row.files.length ? '追加・変更' : '登録'}`}
        onClick={() => openFilesDraft(partNo, row.files)}>{row.files.length ? '編集' : '＋ 登録'}</button>
    </span>;
  };

  /**
   * UnitBaseから取り込んだ2列。読み取り専用で、UnitBaseのCSVを取り込み直すと置き換わる。
   * 調査状況は種類ごとに色を分け、`-`（chemSHERPA入手不可）と完了を見分けやすくする。
   */
  const chemCells = (row: BomRow) => {
    if (isSupplementPart(row.part.partNo)) return <><td><span className="solo-blank">—</span></td><td><span className="solo-blank">—</span></td></>;
    const status = row.chemStatus;
    const tone = !status ? '' : /^(-|－)$/.test(status) ? 'is-unavailable' : status.includes('完了') && !/依頼|やり取り|判定|未依頼|備考参照|対応不可/.test(status) ? 'is-done' : 'is-progress';
    const statusTitle = status === '-' || status === '－' ? 'chemSHERPA入手不可（UnitBase）' : 'UnitBaseのchemSHERPA調査状況（技管からサプライヤへの調査ステータス）';
    return <>
      <td className="bom-chem-cell">{status
        ? <span className={`chem-status ${tone}`} title={statusTitle}>{status}</span>
        : <span className="solo-blank" title="UnitBaseに一致する品番がない、または調査状況が空欄です。">—</span>}</td>
      <td className="bom-chem-cell bom-chem-note" title={row.chemNote || undefined}>{shortChemNote(row.chemNote) || <span className="solo-blank">—</span>}</td>
    </>;
  };

  /** 見出しの下の絞り込み欄。絞り込める列だけ入力欄を出し、ほかの列は空ける。 */
  const filterCell = (label: string, access: BomFilterAccess) => {
    const { value, onChange, chemOptions, levelOptions } = access;
    const textField = ({ '品番': 'partNo', '品名': 'name', '材質・メーカー': 'material', [UNITBASE_NOTE_COLUMN]: 'chemNote' } as Record<string, keyof BomFilter | undefined>)[label];
    const levelFilter = <MultiSelectFilter label="品番の階層（9桁目）" options={levelOptions} selected={value.levels} compact empty="階層"
      hint="品番の9桁目（階層）で絞り込みます。複数選ぶと、いずれかに一致する行を出します（1＝10レベル、4＝40レベル、5・6＝50/60レベル。先頭がZの品番は購入品）"
      onChange={levels => onChange({ ...value, levels })} />;
    if (textField) return wrapPartNo(textField === 'partNo', levelFilter, <input className={`bom-filter ${value[textField] ? 'is-active' : ''}`} type="search" value={value[textField]} placeholder="絞り込み"
      aria-label={`${label}で絞り込む`} title={textField === 'partNo'
        ? '品番に含まれる文字で絞り込みます（部分一致）。\n? は任意の1文字、* は任意の文字列、[456] はどれか1文字（[4-6] も可）で、先頭から桁を合わせて比べます。\n例: ?????????[456] … 10桁目が4・5・6の品番'
        : `${label}に含まれる文字で絞り込みます（部分一致）`}
      onChange={event => onChange({ ...value, [textField]: event.target.value })} />);
    if (label === UNITBASE_STATUS_COLUMN) return <MultiSelectFilter label={label} options={chemOptions} selected={value.chemStatuses}
      hint="調査状況を選んで絞り込みます（複数選ぶと、いずれかに一致する行）" onChange={chemStatuses => onChange({ ...value, chemStatuses })} />;
    if (label === '風船' && isBomFilterActive(value)) return <button type="button" className="bom-filter-clear" title="列の絞り込みをすべて解除します"
      onClick={() => onChange(EMPTY_BOM_FILTER)}>解除</button>;
    return null;
  };

  return <>
    <div className="bom-table"><table>
      <colgroup>
        <col className="bom-balloon" /><col className="bom-part-no" /><col className="bom-version" /><col className="bom-name" /><col className="bom-quantity" /><col className="bom-unit" /><col className="bom-material" />
        <col className="bom-mass" /><col className="bom-total-mass" /><col className="bom-price" /><col className="bom-total-price" /><col className="bom-shai" /><col className="bom-files" /><col className="bom-chem-status" /><col className="bom-chem-note" />
      </colgroup>
      <thead><tr>{BOM_COLUMNS.map(label => {
        /* 手入力する2列だけ、見出しに編集可・不可の切り替えを出す。 */
        const field = label === MASS_COLUMN ? 'mass' : label === PRICE_COLUMN ? 'price' : null;
        return <th key={label}>{label}{field && <button type="button" className={`bom-lock ${unlocked[field] ? 'is-unlocked' : ''}`} aria-pressed={unlocked[field]}
          aria-label={`${label}を${unlocked[field] ? '編集できないようにする' : '編集できるようにする'}`}
          title={unlocked[field] ? `${label}の編集を止めます。書き換えないときは閉じておくと安全です。` : `${label}を編集できるようにします。`}
          onClick={() => toggleLock(field)}>{unlocked[field] ? '🔓' : '🔒'}</button>}</th>;
      })}</tr>
      {filter && <tr className="bom-filter-row">{BOM_COLUMNS.map(label => <th key={label}>{filterCell(label, filter)}</th>)}</tr>}</thead>
      <tbody>{rows.map((row, index) => {
        /* 目印は検索で絞り込んでも同じ行に残るよう、並び順ではなく明細の中身で見分ける。 */
        const key = partKey(row.part), picked = pickedKey === key;
        return <tr key={`${key}-${index}`} className={picked ? 'is-picked' : undefined} aria-current={picked ? 'true' : undefined}
          title={picked ? 'この行に目印を付けています。もう一度押すと外します。' : undefined} onClick={pickRow(key)}>
        <td>{row.part.balloon}</td>
        <td className={isPurchasedPart(row.part.partNo) ? 'purchased-part' : undefined}>{partNoCell(row)}{renderBadges(row.part.partNo)}</td>
        <td>{row.part.version}</td>
        <td title={row.part.name}>{row.part.name}</td>
        <td>{row.part.quantity}</td>
        {/* 数量は個数のことが多く単位は空欄。ケーブルなど長さで数える部品だけ mm などが入る。 */}
        <td className="bom-unit-cell">{row.part.unit ?? ''}</td>
        <td title={row.part.material}>{row.part.material}</td>
        {amountCell(row, 'mass')}
        <td className="solo-calc">{row.totalMass === undefined ? '—' : formatAmount(row.totalMass)}</td>
        {amountCell(row, 'price')}
        <td className="solo-calc">{row.totalPrice === undefined ? '—' : formatAmount(row.totalPrice, 0)}</td>
        <td>{shaiCell(row)}</td>
        <td>{filesCell(row)}</td>
        {chemCells(row)}
      </tr>;
      })}</tbody>
      <tfoot><tr>
        <td colSpan={7}>{totalLabel}</td>
        <td />
        <td className="solo-calc">{massTotal.counted ? formatAmount(massTotal.total) : '—'}</td>
        <td />
        <td className="solo-calc">{priceTotal.counted ? formatAmount(priceTotal.total, 0) : '—'}</td>
        <td />
        <td />
        <td />
        <td />
      </tr></tfoot>
    </table></div>

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

    {filesDraft && <div className="modal-bg" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setFilesDraft(null); }}>
      <div className="modal files-modal" role="dialog" aria-modal="true" aria-labelledby="files-modal-title">
        <h2 id="files-modal-title">その他ファイルのリンク</h2>
        <p><b>{filesDraft.partNo}</b> に紐づけるファイルを、説明と共有リンクで登録します。何件でも登録できます。</p>
        <div className="part-files-editor">
          <div className="part-files-head"><span>説明</span><span>ファイルのリンク</span><span /></div>
          {filesDraft.files.map((file, index) => <div className="part-files-row" key={file.id}>
            <input autoFocus={index === 0} value={file.label} placeholder="例: 試験成績書" aria-label={`${index + 1}件目の説明`}
              onChange={event => changeDraftFile(file.id, { label: event.target.value })} />
            <input value={file.url} placeholder="https://..." aria-label={`${index + 1}件目のリンク`}
              onChange={event => changeDraftFile(file.id, { url: event.target.value })} />
            <button type="button" className="part-files-remove" title="この行を削除" aria-label={`${index + 1}件目を削除`}
              onClick={() => setFilesDraft({ ...filesDraft, error: '', files: filesDraft.files.filter(item => item.id !== file.id) })}>×</button>
          </div>)}
          <button type="button" className="part-files-add" onClick={() => setFilesDraft({ ...filesDraft, files: [...filesDraft.files, newFile()] })}>＋ 行を追加</button>
        </div>
        {filesDraft.error && <div className="model-message">{filesDraft.error}</div>}
        <small className="model-note">Google Drive・SharePointなど、ブラウザーで開ける共有リンクを貼り付けてください。chemSHERPA（.shai）は「Shaiファイル」の列で登録します。</small>
        <div className="modal-actions">
          <button type="button" onClick={() => setFilesDraft(null)}>キャンセル</button>
          <button type="button" className="primary" onClick={saveFilesDraft}>保存</button>
        </div>
      </div>
    </div>}
  </>;
}

/**
 * 備考(import)を表で出すときの短い形。UnitBaseの備考は「デクロランプラス資材調査品番：含有なし」のように
 * 長く、列が詰まるため「資材調査品番」を省く。省いた元の文はセルのツールチップとExcel出力にそのまま残す。
 */
export const shortChemNote = (note: string) => note.replace(/資材調査品番/g, '');

type FilterOption = BomFilterAccess['chemOptions'][number];

/** 品番の欄は、文字の絞り込みの右に階層の選択を並べる。 */
const wrapPartNo = (isPartNo: boolean, levelFilter: ReactNode, input: ReactNode) =>
  isPartNo ? <div className="bom-filter-pair">{input}{levelFilter}</div> : input;

/**
 * 一覧から複数選ぶ絞り込み（chemSHERPA調査状況・品番の階層）。チェックを付けた値の**どれか**に当てはまる行を出す（OR）。
 * 見出しのセルは内容をはみ出させない（overflow: hidden）ため、一覧は画面に固定して出し、
 * 外側をクリック・スクロールすると閉じる。
 */
function MultiSelectFilter({ label, options, selected, onChange, hint, compact, empty = 'すべて' }: {
  label: string; options: FilterOption[]; selected: string[]; onChange: (values: string[]) => void;
  /** 何も選んでいないときのツールチップ。 */
  hint: string;
  /** 幅の狭いボタンにする（品番の欄で入力欄と並べるとき）。 */
  compact?: boolean;
  /** 何も選んでいないときのボタンの文字。 */
  empty?: string;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!anchor) return;
    const close = (event: Event) => {
      const target = event.target as Node;
      if (root.current?.contains(target) || panel.current?.contains(target)) return;
      setAnchor(null);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setAnchor(null); };
    document.addEventListener('mousedown', close);
    document.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [anchor]);

  const labelOf = (value: string) => options.find(option => option.value === value)?.label ?? value;
  const shortLabel = (value: string) => compact ? labelOf(value).replace(/レベル|（Z）/g, '') : labelOf(value);
  const summary = !selected.length ? empty : selected.length <= 2 ? selected.map(shortLabel).join('・') : `${selected.length}件を選択`;
  const toggle = (value: string) => onChange(selected.includes(value) ? selected.filter(item => item !== value)
    /* 並びは選択肢の順にそろえ、表示が押した順で変わらないようにする。 */
    : options.map(option => option.value).filter(item => item === value || selected.includes(item)));

  return <div className={`chem-filter ${compact ? 'is-compact' : ''}`} ref={root}>
    <button type="button" className={`bom-filter chem-filter-toggle ${selected.length ? 'is-active' : ''}`} aria-haspopup="true" aria-expanded={!!anchor}
      aria-label={`${label}で絞り込む`} title={selected.length ? `選択中: ${selected.map(labelOf).join('、')}（いずれかに一致する行を表示）` : hint}
      onClick={event => setAnchor(anchor ? null : event.currentTarget.getBoundingClientRect())}>
      <span>{summary}</span><i aria-hidden="true">▾</i>
    </button>
    {anchor && <div className="chem-filter-panel" ref={panel} role="group" aria-label={`${label}の選択`} style={{ top: anchor.bottom + 4, left: anchor.left, minWidth: anchor.width }}>
      <p>{compact ? '品番の9桁目（階層）。' : ''}複数選ぶと、いずれかに一致する行を出します</p>
      {options.map(option => <label key={option.value} className={option.count ? '' : 'is-empty'}>
        <input type="checkbox" checked={selected.includes(option.value)} onChange={() => toggle(option.value)} />
        <span>{option.label}</span><small>{option.count}</small>
      </label>)}
      <div className="chem-filter-actions">
        <button type="button" onClick={() => onChange(options.map(option => option.value))}>全選択</button>
        <button type="button" onClick={() => onChange([])} disabled={!selected.length}>解除（すべて表示）</button>
      </div>
    </div>}
  </div>;
}
