import { useMemo, useState, type ReactNode } from 'react';
import * as XLSX from 'xlsx';
import { normalizePlVersion, plLabel } from './csv';
import { countParts, excludeNoteParts, plKindLabel, sortPartsByBalloon } from './matrix';
import { formatAmount, type PartFact } from './drawings';
import { buildBomRows, sumBomRows, type Level40Parts } from './bom';
import BomTable, { BOM_COLUMNS, type Level40Access } from './BomTable';
import type { PartsList } from './types';

type Props = {
  /** 単体BOMに出すPL。左の一覧で枠を付けて選んだ1つ。 */
  list: PartsList | undefined;
  /** 選べるPL（今の機種・ユニットに登録されているすべて）。表示チェックとは関係なく選べる。 */
  lists: PartsList[];
  /** 左の一覧・マトリックスBOMと共通の連番。 */
  sequence: Map<string, number>;
  onSelect: (id: string) => void;
  /** 品番ごとの質量・価格・`.shai`。 */
  facts: PartFact[];
  onFactsChange: (facts: PartFact[]) => void;
  /** 品番に紐づく図面・3Dモデルの印。マトリックスBOMと同じものを使う。 */
  renderBadges: (partNo: string) => ReactNode;
  /** 40レベル部品の中身を開く・合計するための入口。 */
  level40: Level40Access;
  level40Parts: Level40Parts;
};

/**
 * 単体BOMは、PLを1つだけ選んで明細をそのまま確認・編集する画面です。
 * マトリックスBOMが複数PLの比較に使う幅を、ここでは質量・価格・chemSHERPA
 * （`.shai`）の列に充てています。質量・価格・`.shai` は**品番ごと**に持つため、
 * どのPLから入力しても同じ品番なら同じ値を表示します。
 */
export default function SoloView({ list, lists, sequence, onSelect, facts, onFactsChange, renderBadges, level40, level40Parts }: Props) {
  const [search, setSearch] = useState('');

  /* 明細の並びはマトリックスBOMと同じ。注記行（風船C）は除く。 */
  const parts = useMemo(() => sortPartsByBalloon(excludeNoteParts(list?.parts ?? [])), [list]);
  const rows = useMemo(() => buildBomRows(parts, facts, level40Parts), [parts, facts, level40Parts]);
  const listed = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(row => `${row.part.partNo} ${row.part.name} ${row.part.material} ${row.part.balloon}`.toLowerCase().includes(needle));
  }, [rows, search]);

  const massTotal = useMemo(() => sumBomRows(listed, row => row.totalMass), [listed]);
  const priceTotal = useMemo(() => sumBomRows(listed, row => row.totalPrice), [listed]);

  const exportExcel = () => {
    if (!list) return;
    const aoa = [
      BOM_COLUMNS,
      ...listed.map(row => [
        row.part.balloon, row.part.partNo, row.part.version, row.part.name, row.part.quantity, row.part.material,
        row.unitMass ?? '', row.totalMass ?? '', row.unitPrice ?? '', row.totalPrice ?? '', row.shaiUrl,
      ]),
      ['', '', '', '', '', '合計', '', massTotal.total || '', '', priceTotal.total || '', ''],
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(aoa), '単体BOM');
    XLSX.writeFile(workbook, `単体BOM_${`${list.plNo}_v${normalizePlVersion(list.plVersion) || '-'}`.replace(/[\\/:*?"<>|]/g, '_')}.xlsx`);
  };

  return <section className="solo-view">
    <div className="solo-head">
      <label className="solo-picker"><span>単体表示するPL</span>
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
        <b>40レベル部品</b>（品番が下線付き）は分解できる部品のため、質量・単価は<b>中身（50/60レベル）の合計</b>で決まります。品番を押すと中身を開いて、そこでも同じ入力ができます。
      </p>

      {listed.length
        ? <BomTable rows={listed} facts={facts} onFactsChange={onFactsChange} renderBadges={renderBadges} level40={level40} totalLabel={`合計（表示中 ${listed.length} 部品）`} />
        : <p className="drawings-empty">{rows.length ? '検索条件に一致する部品はありません。' : 'このPLに部品がありません。'}</p>}
    </> : <p className="drawings-empty">
      単体BOMに出すPLがありません。左の一覧でPLをクリックすると、そのPLを枠で囲んでここに表示します（表示チェックとは別に選べます）。
    </p>}
  </section>;
}
