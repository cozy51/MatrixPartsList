import { useState, type ReactNode } from 'react';
import { displayMass, displayPrice, emptyPartFact, formatAmount, normalizeMassInput, partFactFor, upsertPartFact, type PartFact } from './drawings';
import { isPurchasedPart, isSupplementPart } from './matrix';
import { isLevel40No } from './levels';
import { BOM_COLUMNS, MASS_COLUMN, PRICE_COLUMN, sumBomRows, type BomRow } from './bom';
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
};


/**
 * 部品明細に、質量・価格・chemSHERPA（`.shai`）の列を加えた表です。
 * 単体BOMのタブと、40レベル部品の中身のポップアップで**同じ表**を使います。
 * 40レベル部品の質量・単価は中身（50/60レベル）の合計で決まるため、その行は
 * 入力欄にせず、計算した値と内訳の注記を出します。
 */
export default function BomTable({ rows, facts, onFactsChange, renderBadges, level40, totalLabel }: Props) {
  /* 1つのセルを編集している間だけ下書きを持つ。入力のたびに保存すると同期の
     リビジョンが上がり続けるため、確定（フォーカスを外す・Enter）で書き込む。 */
  const [draft, setDraft] = useState<{ partNo: string; field: 'mass' | 'price'; value: string } | null>(null);
  const [shaiDraft, setShaiDraft] = useState<{ partNo: string; value: string; error: string } | null>(null);
  /* 質量と単価は見た目が似ていて取り違えやすいため、初めは編集できない状態にし、
     見出しの鍵ボタンで列ごとに切り替える。同じ画面でも別々に開け閉めできる。 */
  const [unlocked, setUnlocked] = useState<{ mass: boolean; price: boolean }>({ mass: false, price: false });
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
      const unregistered = !summary;
      /* 40レベル部品は中身（50/60レベル）の合計で決まり、この欄には入力できない。
         合計が出せなくても入れ忘れではないため、未入力の色は付けない。 */
      return <td>
        <span className={`bom-derived ${unregistered ? 'is-unregistered' : ''}`} title={unregistered
          ? `40レベル部品のリストが未登録のため、中身の${label}を合計できません。`
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

  return <>
    <div className="bom-table"><table>
      <colgroup>
        <col className="bom-balloon" /><col className="bom-part-no" /><col className="bom-version" /><col className="bom-name" /><col className="bom-quantity" /><col className="bom-material" />
        <col className="bom-mass" /><col className="bom-total-mass" /><col className="bom-price" /><col className="bom-total-price" /><col className="bom-shai" />
      </colgroup>
      <thead><tr>{BOM_COLUMNS.map(label => {
        /* 手入力する2列だけ、見出しに編集可・不可の切り替えを出す。 */
        const field = label === MASS_COLUMN ? 'mass' : label === PRICE_COLUMN ? 'price' : null;
        return <th key={label}>{label}{field && <button type="button" className={`bom-lock ${unlocked[field] ? 'is-unlocked' : ''}`} aria-pressed={unlocked[field]}
          aria-label={`${label}を${unlocked[field] ? '編集できないようにする' : '編集できるようにする'}`}
          title={unlocked[field] ? `${label}の編集を止めます。書き換えないときは閉じておくと安全です。` : `${label}を編集できるようにします。`}
          onClick={() => toggleLock(field)}>{unlocked[field] ? '🔓' : '🔒'}</button>}</th>;
      })}</tr></thead>
      <tbody>{rows.map((row, index) => <tr key={`${row.part.balloon}-${row.part.partNo}-${row.part.version}-${index}`}>
        <td>{row.part.balloon}</td>
        <td className={isPurchasedPart(row.part.partNo) ? 'purchased-part' : undefined}>{partNoCell(row)}{renderBadges(row.part.partNo)}</td>
        <td>{row.part.version}</td>
        <td title={row.part.name}>{row.part.name}</td>
        <td>{row.part.quantity}</td>
        <td title={row.part.material}>{row.part.material}</td>
        {amountCell(row, 'mass')}
        <td className="solo-calc">{row.totalMass === undefined ? '—' : formatAmount(row.totalMass)}</td>
        {amountCell(row, 'price')}
        <td className="solo-calc">{row.totalPrice === undefined ? '—' : formatAmount(row.totalPrice, 0)}</td>
        <td>{shaiCell(row)}</td>
      </tr>)}</tbody>
      <tfoot><tr>
        <td colSpan={6}>{totalLabel}</td>
        <td />
        <td className="solo-calc">{massTotal.counted ? formatAmount(massTotal.total) : '—'}</td>
        <td />
        <td className="solo-calc">{priceTotal.counted ? formatAmount(priceTotal.total, 0) : '—'}</td>
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
  </>;
}
