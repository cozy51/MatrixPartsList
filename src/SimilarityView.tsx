import { useMemo, useState, type ReactNode } from 'react';
import * as XLSX from 'xlsx';
import { plLabel } from './csv';
import { buildPlVersionGroups, calculatePlSimilarities, comparePlParts, isCustomerSpecialPl, plKindLabel, plVersionLabel, type PlPartComparison } from './matrix';
import { buildBomRows, compareBomAmounts, excelAmount, totalsOf, trimFloatNoise, type BomRow, type BomTotals, type ComparisonAmounts, type Level40Parts } from './bom';
import { formatAmount, type PartFact } from './drawings';
import type { Part, PartsList } from './types';

type Props = {
  lists: PartsList[];
  sequence: Map<string,number>;
  baseId: string;
  onBaseChange: (id: string) => void;
  /** 品番に紐づく図面・3Dモデルの印。マトリックスBOMと同じものを使う。 */
  renderBadges: (partNo: string) => ReactNode;
  /** 品番ごとの質量・単価。単体BOMで入れたものをそのまま使う。 */
  facts: PartFact[];
  /** 40レベル部品の質量・単価は中身（50/60レベル）の合計で決まる。 */
  level40Parts: Level40Parts;
};

/** 質量・金額の表示。入っている部品が1つもないときは「—」にする。 */
const massText = (totals: BomTotals) => totals.mass.counted ? `${formatAmount(totals.mass.total)} kg` : '—';
const priceText = (totals: BomTotals) => totals.price.counted ? `${formatAmount(totals.price.total, 0)} 円` : '—';
/** 差は増減が一目で分かるよう符号を付ける。 */
const signedText = (value: number, digits: number, unit: string) =>
  `${value > 0 ? '+' : value < 0 ? '-' : '±'}${formatAmount(Math.abs(value), digits)} ${unit}`;
const diffClass = (value: number) => value > 0 ? 'is-up' : value < 0 ? 'is-down' : '';

type DetailSectionProps = { title: string; rows: BomRow[]; tone: 'common' | 'base' | 'target'; renderBadges: (partNo: string) => ReactNode };

function DetailSection({ title, rows, tone, renderBadges }: DetailSectionProps) {
  const totals = totalsOf(rows);
  return <section className={`similarity-detail-section ${tone}`}>
    <h3>{title}<span>{rows.length} 部品</span></h3>
    {/* このまとまりだけの合計。下の表の「質量」「金額」を足したもの。 */}
    <div className="similarity-detail-total">
      <span>質量<b>{massText(totals)}</b><i>{totals.mass.counted}/{rows.length} 部品</i></span>
      <span>金額<b>{priceText(totals)}</b><i>{totals.price.counted}/{rows.length} 部品</i></span>
    </div>
    {rows.length ? <div className="similarity-detail-table"><table>
      <colgroup><col className="detail-balloon"/><col className="detail-part-no"/><col className="detail-version"/><col className="detail-name"/><col className="detail-quantity"/><col className="detail-material"/><col className="detail-mass"/><col className="detail-price"/></colgroup>
      <thead><tr><th>風船</th><th>品番</th><th>Ver.</th><th>品名</th><th>数量</th><th>材質・メーカー</th><th>質量（kg）</th><th>金額（円）</th></tr></thead>
      <tbody>{rows.map(({ part, unitMass, unitPrice, totalMass, totalPrice }) => <tr key={`${part.balloon}-${part.partNo}-${part.version}-${part.name}-${part.quantity}`}>
        <td>{part.balloon}</td><td>{part.partNo}{renderBadges(part.partNo)}</td><td>{part.version}</td><td>{part.name}</td><td>{part.quantity}</td><td>{part.material}</td>
        {/* 表に出すのは数量をかけたあと。単品の値はカーソルを合わせると出す。 */}
        <td className="detail-amount" title={unitMass === undefined ? '単品質量が入っていません。単体BOMで入力できます。' : `単品質量 ${formatAmount(unitMass)} kg × ${part.quantity}`}>{totalMass === undefined ? '—' : formatAmount(totalMass)}</td>
        <td className="detail-amount" title={unitPrice === undefined ? '単価が入っていません。単体BOMで入力できます。' : `単価 ${formatAmount(unitPrice, 0)} 円 × ${part.quantity}`}>{totalPrice === undefined ? '—' : formatAmount(totalPrice, 0)}</td>
      </tr>)}</tbody>
    </table></div> : <p>該当する部品はありません。</p>}
  </section>;
}

type AmountSummaryProps = { amounts: ComparisonAmounts; baseName: string; targetName: string };

/** 質量・金額が2つのPLでどれだけ違うかを、内訳と合計の両方で見せる。 */
function AmountSummary({ amounts, baseName, targetName }: AmountSummaryProps) {
  const { common, baseOnly, targetOnly, base, target, massDiff, priceDiff } = amounts;
  return <div className="similarity-amounts">
    <table>
      <thead><tr>
        <th />
        <th>共通部品</th><th>{baseName} のみ</th><th>{targetName} のみ</th>
        <th>{baseName} 合計</th><th>{targetName} 合計</th><th>差</th>
      </tr></thead>
      <tbody>
        <tr>
          <th>質量</th>
          <td>{massText(common)}</td><td>{massText(baseOnly)}</td><td>{massText(targetOnly)}</td>
          <td className="is-total">{massText(base)}</td><td className="is-total">{massText(target)}</td>
          <td className={`is-diff ${diffClass(massDiff)}`}>{signedText(massDiff, 3, 'kg')}</td>
        </tr>
        <tr>
          <th>金額</th>
          <td>{priceText(common)}</td><td>{priceText(baseOnly)}</td><td>{priceText(targetOnly)}</td>
          <td className="is-total">{priceText(base)}</td><td className="is-total">{priceText(target)}</td>
          <td className={`is-diff ${diffClass(priceDiff)}`}>{signedText(priceDiff, 0, '円')}</td>
        </tr>
      </tbody>
    </table>
    {/* 未入力の部品を0として足すと合計を見誤るため、入っている件数を必ず添える。 */}
    <p>
      入力がある部品だけを合計しています。質量は {baseName} {base.mass.counted}/{base.parts} 部品・{targetName} {target.mass.counted}/{target.parts} 部品、
      金額は {baseName} {base.price.counted}/{base.parts} 部品・{targetName} {target.price.counted}/{target.parts} 部品に入っています。
      差は「{targetName} 合計 − {baseName} 合計」で、共通部品は両方に同じだけ入るため打ち消し合います。
    </p>
  </div>;
}

const partRows = (rows: BomRow[]) => [
  ['風船', '品番', 'Ver.', '品名', '数量', '材質・メーカー', '単品質量（kg）', '合計質量（kg）', '単価（円）', '金額（円）'],
  ...rows.map(({ part, unitMass, unitPrice, totalMass, totalPrice }) =>
    [part.balloon, part.partNo, part.version, part.name, part.quantity, part.material, excelAmount(unitMass), excelAmount(totalMass), excelAmount(unitPrice), excelAmount(totalPrice)]),
];

type ExportRows = { common: BomRow[]; baseOnly: BomRow[]; targetOnly: BomRow[] };

function exportComparison(base: PartsList, target: PartsList, rows: ExportRows, amounts: ComparisonAmounts, score: number) {
  const workbook = XLSX.utils.book_new();
  const amountRow = (label: string, pick: (totals: BomTotals) => number, counted: (totals: BomTotals) => number, diff: number) => [
    label,
    trimFloatNoise(pick(amounts.common)), trimFloatNoise(pick(amounts.baseOnly)), trimFloatNoise(pick(amounts.targetOnly)),
    trimFloatNoise(pick(amounts.base)), trimFloatNoise(pick(amounts.target)), trimFloatNoise(diff),
    `基準 ${counted(amounts.base)}/${amounts.base.parts} 部品・比較 ${counted(amounts.target)}/${amounts.target.parts} 部品に入力あり`,
  ];
  const summary = [
    ['基準PL', plLabel(base)],
    ['比較PL', plLabel(target)],
    ['類似度', `${(score * 100).toFixed(1)}%`],
    ['共通部品', rows.common.length],
    ['基準PLのみ', rows.baseOnly.length],
    ['比較PLのみ', rows.targetOnly.length],
    [],
    ['', '共通部品', '基準PLのみ', '比較PLのみ', '基準PL合計', '比較PL合計', '差（比較−基準）', '備考'],
    amountRow('質量（kg）', totals => totals.mass.total, totals => totals.mass.counted, amounts.massDiff),
    amountRow('金額（円）', totals => totals.price.total, totals => totals.price.counted, amounts.priceDiff),
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summary), '比較概要');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(partRows(rows.common)), '共通部品');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(partRows(rows.baseOnly)), '基準PLのみ');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(partRows(rows.targetOnly)), '比較PLのみ');
  const safeName = `${base.plNo}-${target.plNo}`.replace(/[\\/:*?"<>|]/g, '_');
  XLSX.writeFile(workbook, `PL比較_${safeName}.xlsx`);
}

export default function SimilarityView({ lists, sequence, baseId, onBaseChange, renderBadges, facts, level40Parts }: Props) {
  const [expandedId, setExpandedId] = useState('');
  const effectiveBaseId = lists.some(list => list.id === baseId) ? baseId : lists[0]?.id ?? '';
  const base = lists.find(list => list.id === effectiveBaseId);
  const results = useMemo(
    () => calculatePlSimilarities(lists, effectiveBaseId),
    [lists, effectiveBaseId],
  );
  /** 同じPL番号でVer.が違うPLは、番号が同じで見分けにくい。どの行がどのVer.かを印で示す。 */
  const versionGroups = useMemo(() => buildPlVersionGroups(lists), [lists]);
  const versionNote = (list: PartsList) => {
    const versions = versionGroups.get(list.plNo.trim().toUpperCase());
    if (!versions) return '';
    const own = plVersionLabel(list.plVersion);
    const others = versions.filter(version => version !== own);
    return others.length ? `この行はVer.${own}です。同じPL番号でVer.${others.join('・')}も比較に入っています。` : '';
  };
  /** 比較した部品に、単体BOMで入れた質量・単価を当てはめる。 */
  const toRows = (parts: Part[]) => buildBomRows(parts, facts, level40Parts);
  const detailRows = (detail: PlPartComparison): ExportRows =>
    ({ common: toRows(detail.common), baseOnly: toRows(detail.baseOnly), targetOnly: toRows(detail.targetOnly) });

  if (!lists.length || !base) return <div className="similarity-empty">表示対象のPLを選択してください。</div>;

  return <section className="similarity-view">
    <div className="similarity-controls">
      <div><h2>PL間の類似度</h2><p>共通部品 ÷ 全部品（Jaccard係数）・品番と数量が同じ部品は同じものとして数えます・行をクリックすると詳細を表示</p></div>
      <label><span>基準PL</span><select value={effectiveBaseId} onChange={event => { onBaseChange(event.target.value); setExpandedId(''); }}>{lists.map(list => <option key={list.id} value={list.id}>{sequence.get(list.id)}. {plLabel(list)}</option>)}</select></label>
    </div>
    <div className="similarity-list">{results.map((result, index) => {
      const expanded = expandedId === result.list.id;
      const detail = expanded ? comparePlParts(base, result.list) : null;
      const rows = detail && detailRows(detail);
      const amounts = rows && compareBomAmounts(rows.common, rows.baseOnly, rows.targetOnly);
      return <article className={`similarity-row ${result.list.id === effectiveBaseId ? 'is-base' : ''} ${expanded ? 'is-expanded' : ''}`} key={result.list.id}>
        <button className="similarity-summary" type="button" aria-expanded={expanded} onClick={() => setExpandedId(expanded ? '' : result.list.id)}>
          <span className="similarity-rank">{index + 1}</span>
          <span className="similarity-name"><b><span className="pl-sequence">{sequence.get(result.list.id)}.</span>{plLabel(result.list)}</b>{versionNote(result.list) && <span className="pl-version-badge" title={versionNote(result.list)}>Ver違い</span>}{plKindLabel(result.list.plNo) && <span className={`standard-badge ${isCustomerSpecialPl(result.list.plNo) ? 'is-custom' : ''}`}>{plKindLabel(result.list.plNo)}</span>}<small>{result.list.plName}</small></span>
          <span className="similarity-meter"><span style={{ width: `${result.score * 100}%` }} /></span>
          <strong>{(result.score * 100).toFixed(1)}%</strong>
          <small>{result.common} 共通 / {result.union} 全部品</small>
          <span className="similarity-chevron" aria-hidden="true">⌄</span>
        </button>
        {rows && amounts && <div className="similarity-details">
          <div className="similarity-details-actions"><span>{plLabel(base)} と {plLabel(result.list)} の比較結果</span><button className="excel" type="button" onClick={() => exportComparison(base, result.list, rows, amounts, result.score)}>Excel出力</button></div>
          <AmountSummary amounts={amounts} baseName={plLabel(base)} targetName={plLabel(result.list)} />
          <DetailSection title="共通部品" rows={rows.common} tone="common" renderBadges={renderBadges} />
          <DetailSection title={`${plLabel(base)} のみ`} rows={rows.baseOnly} tone="base" renderBadges={renderBadges} />
          <DetailSection title={`${plLabel(result.list)} のみ`} rows={rows.targetOnly} tone="target" renderBadges={renderBadges} />
        </div>}
      </article>;
    })}</div>
  </section>;
}
