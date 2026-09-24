import { useMemo, useState, type ReactNode } from 'react';
import { normalizePlVersion, plLabel } from './csv';
import { countParts, excludeNoteParts, plKindLabel, sortPartsByBalloon } from './matrix';
import { formatAmount, type PartFact } from './drawings';
import { buildBomRows, exportBomExcel, sumBomRows, type Level40Parts } from './bom';
import BomTable, { type Level40Access } from './BomTable';
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
  /** クリップボードから図面リンクを取り込む。マトリックスBOMの同名ボタンと同じ処理。 */
  onCaptureDrawings: () => void;
};

/**
 * 単体BOMは、PLを1つだけ選んで明細をそのまま確認・編集する画面です。
 * マトリックスBOMが複数PLの比較に使う幅を、ここでは質量・価格・chemSHERPA
 * （`.shai`）の列に充てています。質量・価格・`.shai` は**品番ごと**に持つため、
 * どのPLから入力しても同じ品番なら同じ値を表示します。
 */
export default function SoloView({ list, lists, sequence, onSelect, facts, onFactsChange, renderBadges, level40, level40Parts, onCaptureDrawings }: Props) {
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

  /* 出すのは検索で絞ったあとの行。40レベル部品の中身のポップアップと同じ処理を使う。 */
  const exportExcel = () => { if (list) exportBomExcel(list, listed, '単体BOM'); };

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
      {/* 図面リンクの取り込みは表示中のPLに依らず全品番が対象のため、PL未選択でも押せる。 */}
      <button type="button" className="drawing-capture" onClick={onCaptureDrawings} title="社内システムでコピーした図面のリンクを、この画面のまま取り込みます">📋 図面リンク取得</button>
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
        質量・価格・chemSHERPA（<code>.shai</code>）・その他ファイルは<b>品番ごと</b>に保存します。どのPLから入れても、同じ品番なら同じ値を表示します。
        <b>その他ファイル</b>には、試験成績書・カタログなど <code>.shai</code> 以外のファイルを、<b>説明を付けて何件でも</b>登録できます。
        単品質量は、CSV・Excelから読み込んだ値を薄い文字で出しています。<b>空欄のままならその値</b>を使い、入力すると入力した値で上書きします。
        単位は<b>kg</b>ですが、<code>8.28g</code> のように<b>gを付けて入力するとkgに直して</b>保存します（<code>0.00828</code>）。
        取り違えを防ぐため、<b>単品質量と単価は初めは編集できません</b>。見出しの <b>🔒</b> を押すと、その列だけ編集できるようになります（🔓）。
        <b>入力できるセルで値が入っていないものは、背景を薄い橙</b>にしています。入れ忘れを探すときの目印にしてください。
        <b>行をクリックすると、その行に黄色い目印</b>が残ります。カーソルを外しても消えないため、長い明細を上から順に見ていくときの「どこまで見たか」に使えます（もう一度押すと外れます）。
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
