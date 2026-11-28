import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { normalizePlVersion, plLabel } from './csv';
import { countParts, excludeNoteParts, plKindLabel, sortPartsByBalloon } from './matrix';
import { formatAmount, type PartFact } from './drawings';
import { EMPTY_BOM_FILTER, buildBomRows, chemStatusLabel, chemStatusOptions, expandBomRows, exportBomTreeExcel, filterBomTree, partLevelOptions, filterBomRows, isBomFilterActive, sumBomTree, type BomFilter, type BomTreeRow, type Level40Parts } from './bom';
import BomTable, { type Level40Access } from './BomTable';
import type { PartsList } from './types';
import UnitBaseBar from './UnitBaseBar';
import type { UnitBaseData, UnitBaseLookup } from './unitbase';

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
  /** UnitBaseから取り込んだchemSHERPA調査状況・備考。 */
  unitBase: UnitBaseData | undefined;
  unitBaseLookup: UnitBaseLookup;
  onUnitBaseReplace: (data: UnitBaseData) => Promise<void>;
};

/**
 * 単体BOMは、PLを1つだけ選んで明細をそのまま確認・編集する画面です。
 * マトリックスBOMが複数PLの比較に使う幅を、ここでは質量・価格・chemSHERPA
 * （`.shai`）の列に充てています。質量・価格・`.shai` は**品番ごと**に持つため、
 * どのPLから入力しても同じ品番なら同じ値を表示します。
 */
export default function SoloView({ list, lists, sequence, onSelect, facts, onFactsChange, renderBadges, level40, level40Parts, onCaptureDrawings, unitBase, unitBaseLookup, onUnitBaseReplace }: Props) {
  const [search, setSearch] = useState('');
  /* 列ごとの絞り込み（見出しの下の入力欄）。上の検索と同時に使え、両方を満たす行だけ出す。 */
  const [columnFilter, setColumnFilter] = useState<BomFilter>(EMPTY_BOM_FILTER);

  /* 明細の並びはマトリックスBOMと同じ。注記行（風船C）は除く。 */
  const parts = useMemo(() => sortPartsByBalloon(excludeNoteParts(list?.parts ?? [])), [list]);
  const rows = useMemo(() => buildBomRows(parts, facts, level40Parts, unitBaseLookup), [parts, facts, level40Parts, unitBaseLookup]);
  /* 40レベル部品の中身もすべて開いた一覧。検索・絞り込みは中身の行にも掛ける。 */
  const tree = useMemo(() => expandBomRows(rows, facts, level40Parts, unitBaseLookup, () => true), [rows, facts, level40Parts, unitBaseLookup]);
  /* 上の検索だけで絞った行。chemSHERPAの選択肢の件数を、ほかの絞り込みと合わせた「今の件数」にするために分けて持つ。 */
  const searched = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle ? tree.filter(row => `${row.part.partNo} ${row.part.name} ${row.part.material} ${row.balloonLabel}`.toLowerCase().includes(needle)) : tree;
  }, [tree, search]);
  const matched = useMemo(() => filterBomRows(searched, columnFilter), [searched, columnFilter]);
  /* 件数は、検索とchemSHERPA以外の列の絞り込みを満たす行で数える（chemSHERPA自体の選択では変わらない）。
     今の条件で0件になった状況や、PLを切り替えて無くなった選択中の状況も、選択肢から消さず0件として残す。 */
  const chemOptions = useMemo(() => {
    const options = chemStatusOptions(filterBomRows(searched, { ...columnFilter, chemStatuses: [] }));
    const known = new Set(options.map(option => option.value));
    const rest = [...chemStatusOptions(tree).map(option => option.value), ...columnFilter.chemStatuses].filter(value => !known.has(value) && (known.add(value), true));
    return [...options, ...rest.map(value => ({ value, label: chemStatusLabel(value), count: 0 }))];
  }, [tree, searched, columnFilter]);
  /* 階層の件数も同じ考え方で、階層自体の選択を除いたほかの条件で数える。 */
  const levelOptions = useMemo(() => partLevelOptions(filterBomRows(searched, { ...columnFilter, levels: [] })), [searched, columnFilter]);
  const filtering = search.trim() !== '' || isBomFilterActive(columnFilter);
  const matchedPaths = useMemo(() => new Set(matched.map(row => row.path)), [matched]);

  /* 40レベル部品の中身は、ポップアップではなく表の中で開閉する。開いている行は親からたどった名前で覚え、PLを替えたら閉じる。
     絞り込み中は一致した中身が見えるよう初めから開いておき、利用者が折りたたんだ行だけを別に覚える。 */
  const [openPaths, setOpenPaths] = useState<Set<string>>(() => new Set());
  const [closedPaths, setClosedPaths] = useState<Set<string>>(() => new Set());
  useEffect(() => { setOpenPaths(new Set()); setClosedPaths(new Set()); }, [list?.id]);
  const flip = (path: string) => (current: Set<string>) => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  };
  const expand = useMemo(() => filtering
    ? { isOpen: (path: string) => !closedPaths.has(path), toggle: (path: string) => setClosedPaths(flip(path)) }
    : { isOpen: (path: string) => openPaths.has(path), toggle: (path: string) => setOpenPaths(flip(path)) }, [filtering, openPaths, closedPaths]);
  /* 絞り込み中は、一致した行とその親（どの40レベル部品の中身か分かるように）を出す。 */
  const shown = useMemo(() => filtering
    ? filterBomTree(tree, matchedPaths, path => closedPaths.has(path))
    : expandBomRows(rows, facts, level40Parts, unitBaseLookup, expand.isOpen), [filtering, tree, matchedPaths, closedPaths, rows, facts, level40Parts, unitBaseLookup, expand]);
  /* Excelはマルチレベルで、40レベル部品の中身をすべて開いた形で出す。絞り込み中は一致した行とその親だけ。 */
  const exportRows = useMemo(() => filtering ? filterBomTree(tree, matchedPaths) : tree, [filtering, tree, matchedPaths]);
  /* まとめて開閉できる行。絞り込み中は、一致した中身を持つ行だけが対象。 */
  const openable = (filtering ? exportRows : tree).filter(row => row.hasChildren);
  const allOpen = openable.length > 0 && openable.every(row => expand.isOpen(row.path));
  const toggleAll = () => {
    const paths = openable.map(row => row.path);
    /* 絞り込み中は「折りたたんだ行」を、そうでなければ「開いた行」を覚えている。 */
    if (filtering) setClosedPaths(allOpen ? new Set(paths) : new Set());
    else setOpenPaths(allOpen ? new Set() : new Set(paths));
  };
  /* 表示中の件数。絞り込みがなければPLの明細そのものの件数。 */
  const count = filtering ? matched.length : rows.length;

  /* 中身の行は親の数量を掛けてPL全体での量に直し、親と二重に数えない。 */
  const counts = (row: BomTreeRow) => filtering ? matchedPaths.has(row.path) : true;
  const massTotal = useMemo(() => sumBomTree(tree, counts, row => row.totalMass), [tree, matchedPaths, filtering]);
  const priceTotal = useMemo(() => sumBomTree(tree, counts, row => row.totalPrice), [tree, matchedPaths, filtering]);

  /* 出すのは検索で絞ったあとの行。40レベル部品の中身も、レベルの列を付けてすべて出す。 */
  const exportExcel = () => { if (list) exportBomTreeExcel(list, exportRows, '単体BOM'); };

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
      <button type="button" className="excel" onClick={exportExcel} disabled={!list || !count}
        title={`${filtering ? '検索・絞り込みで表示中の行' : '表示中のPLの明細'}を、40レベル部品の中身も含めたマルチレベルでExcelに出力します（中身はExcelのグループで折りたためます）`}>{filtering ? `Excel出力（表示中 ${count} 部品）` : 'Excel出力'}</button>
      {openable.length > 0 && <button type="button" className="level40-toggle-all" onClick={toggleAll}
        title="40レベル部品の中身（50/60レベル）を、表の中でまとめて展開・折りたたみます">{allOpen ? '▾ 中身をすべて折りたたむ' : '▸ 中身をすべて展開'}</button>}
    </div>

    <UnitBaseBar data={unitBase} onReplace={onUnitBaseReplace} />

    {list ? <>
      <div className="solo-summary">
        <div>
          <h3>{list.plNo}{renderBadges(list.plNo)}</h3>
          <p>{list.plName || list.fileName}</p>
          <small>{plKindLabel(list.plNo) ? `${plKindLabel(list.plNo)} ・ ` : ''}Ver.{normalizePlVersion(list.plVersion) || '-'} ・ {countParts(list.parts)} 部品{filtering && ` ・ 絞り込み ${count} 部品`}</small>
        </div>
        <dl className="solo-totals">
          <div><dt>合計質量</dt><dd>{massTotal.counted ? `${formatAmount(massTotal.total)} kg` : '—'}<small>{massTotal.counted} / {count} 部品</small></dd></div>
          <div><dt>合計金額</dt><dd>{priceTotal.counted ? `${formatAmount(priceTotal.total, 0)} 円` : '—'}<small>{priceTotal.counted} / {count} 部品</small></dd></div>
        </dl>
      </div>

      {/* 使い方の説明は長いため、取り違えに関わる重要なものだけを常に出し、残りは畳んでおく。 */}
      <div className="solo-note">
        <p>
          質量・価格・chemSHERPA（<code>.shai</code>）・その他ファイルは<b>品番ごと</b>に保存します。どのPLから入れても、同じ品番なら同じ値を表示します。
          取り違えを防ぐため、<b>単品質量と単価は初めは編集できません</b>。見出しの <b>🔒</b> を押すと、その列だけ編集できるようになります（🔓）。
          <b>40レベル部品</b>は分解できる部品のため、質量・単価は<b>中身（50/60レベル）の合計</b>で決まります。品番の <b>▸</b> を押すと中身をすぐ下に展開し（風船は <code>7-1</code> のように親の風船につなげて表示）、そこでも同じ入力ができます。Excelは中身も含めたマルチレベルで出力します。
        </p>
        <details>
          <summary>そのほかの使い方</summary>
          <p>
            <b>その他ファイル</b>には、試験成績書・カタログなど <code>.shai</code> 以外のファイルを、<b>説明を付けて何件でも</b>登録できます。
            単品質量は、CSV・Excelから読み込んだ値を薄い文字で出しています。<b>空欄のままならその値</b>を使い、入力すると入力した値で上書きします。
            単位は<b>kg</b>ですが、<code>8.28g</code> のように<b>gを付けて入力するとkgに直して</b>保存します（<code>0.00828</code>）。
            <b>入力できるセルで値が入っていないものは、背景を薄い橙</b>にしています。入れ忘れを探すときの目印にしてください。
            <b>行をクリックすると、その行に黄色い目印</b>が残ります。カーソルを外しても消えないため、長い明細を上から順に見ていくときの「どこまで見たか」に使えます（もう一度押すと外れます）。
            <b>chemSHERPA(import)・備考(import)</b>は、UnitBaseから出力したCSVの「chemSHERPA調査状況」「備考」を<b>品番（子品番単位）が一致</b>した部品に出しています（編集不可）。UnitBaseを更新したら、出力したCSV（またはExcel）を<b>「ファイルから取込」</b>で選ぶか帯へドラッグ＆ドロップすると置き換わります（取り込んだ内容はクラウドへ同期します）。40レベル部品の中身のポップアップにも同じ2列を出します。
            見出しのすぐ下の<b>絞り込み欄</b>で、品番・品名・材質・備考(import)は含まれる文字で（品番は <code>?</code>＝任意の1文字・<code>*</code>＝任意の文字列・<code>[456]</code>＝どれか1文字で先頭から桁を合わせて絞れます。例: <code>?????????[456]</code> で10桁目が4・5・6。品番の階層＝9桁目は、入力欄の右の<b>「階層」</b>から40レベル・50/60レベル・購入品（先頭がZ）などを選んで絞れます）、chemSHERPA(import)は一覧でチェックを付けた調査状況で行を絞り込めます（<b>複数選ぶと、いずれかに一致する行</b>を出します。一覧の件数は、検索とほかの列の絞り込みを満たす今の件数です。右上の検索と同時に使え、合計・Excel出力も絞り込んだ行が対象です。「解除」ですべて戻ります）。
          </p>
        </details>
      </div>

      {/* 列の絞り込みで0件になっても入力欄を消さないよう、PLに部品があれば表は出し続ける。 */}
      {rows.length
        ? <BomTable rows={shown} expand={expand} facts={facts} onFactsChange={onFactsChange} renderBadges={renderBadges} level40={level40} totalLabel={`合計（表示中 ${count} 部品）`} totals={{ mass: massTotal, price: priceTotal }}
            filter={{ value: columnFilter, onChange: setColumnFilter, chemOptions, levelOptions }} />
        : <p className="drawings-empty">このPLに部品がありません。</p>}
      {rows.length > 0 && !count && <p className="drawings-empty">検索・絞り込みの条件に一致する部品はありません。</p>}
    </> : <p className="drawings-empty">
      単体BOMに出すPLがありません。左の一覧でPLをクリックすると、そのPLを枠で囲んでここに表示します（表示チェックとは別に選べます）。
    </p>}
  </section>;
}
