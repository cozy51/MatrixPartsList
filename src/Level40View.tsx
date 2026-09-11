import { useMemo, useState, type ReactNode } from 'react';
import type { PartsList } from './types';
import { plLabel } from './csv';
import { sortPartsLists } from './matrix';

type Props = {
  /** 登録済みの40レベル部品。 */
  lists: PartsList[];
  /** 中身（50/60レベル）をポップアップで開く。 */
  onOpen: (list: PartsList) => void;
  /** 登録を削除する。 */
  onRemove: (list: PartsList) => void;
  /** 品番に紐づく図面・3Dモデルの印。部品表と同じものを使う。 */
  renderBadges: (partNo: string) => ReactNode;
};

/**
 * 40レベル（9桁目が `4`）は分解できる部品です。部品と同じ扱いで機種・ユニットに属さず、
 * マトリックス部品表には並べないため、登録済みの一覧はこのタブにまとめています。
 * 番号を押すと、その中身（50/60レベル）をポップアップで開きます。
 */
export default function Level40View({ lists, onOpen, onRemove, renderBadges }: Props) {
  const [search, setSearch] = useState('');

  const sorted = useMemo(() => sortPartsLists(lists), [lists]);
  const listed = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return sorted;
    return sorted.filter(list => `${list.plNo} ${list.plName} ${list.fileName}`.toLowerCase().includes(needle));
  }, [sorted, search]);
  /** 同じ番号でVer.違いが登録されているものは、取り違えないよう印を付ける。 */
  const multiVersionNos = useMemo(() => {
    const counts = new Map<string, number>();
    for (const list of lists) {
      const key = list.plNo.trim().toUpperCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return new Set([...counts].filter(([, count]) => count > 1).map(([key]) => key));
  }, [lists]);

  return <section className="drawings-view level40-view">
    <div className="drawings-list-head">
      <div>
        <h3>登録済み40レベル部品</h3>
        <p>{lists.length} 件{search.trim() && ` ・ 検索一致 ${listed.length} 件`}</p>
      </div>
      <label className="search-box"><span aria-hidden="true">🔍</span>
        <input className="search" aria-label="40レベル部品を検索" placeholder="番号・名称を検索..." value={search} onChange={event => setSearch(event.target.value)} />
      </label>
    </div>

    <p className="level40-note">
      40レベル（9桁目が <code>4</code>）は分解できる部品です。<b>部品と同じ扱い</b>で機種・ユニットに属さないため、マトリックス部品表には並べません。
      部品表の明細で40レベルの品番を押すか、この一覧の番号を押すと、中身（50/60レベル）を開けます。
    </p>

    {listed.length ? <div className="drawings-table"><table>
      <thead><tr><th>番号</th><th>Ver.</th><th>名称</th><th>部品数</th><th>図面・3Dモデル</th><th>操作</th></tr></thead>
      <tbody>{listed.map(list => <tr key={list.id}>
        <td>
          <button type="button" className="level40-open" title={`${plLabel(list)} の中身（50/60レベル）を開く`} onClick={() => onOpen(list)}>
            <span>{list.plNo}</span>
          </button>
          {multiVersionNos.has(list.plNo.trim().toUpperCase()) && <span className="pl-version-badge" title="同じ番号でVer.違いが登録されています。">Ver違い</span>}
          <small>{list.fileName}</small>
        </td>
        <td>{list.plVersion ? `v${list.plVersion}` : '—'}</td>
        <td>{list.plName || '—'}</td>
        <td>{list.parts.length}</td>
        <td>{renderBadges(list.plNo)}</td>
        <td className="drawing-actions">
          <button type="button" onClick={() => onOpen(list)}>中身を開く</button>
          <button type="button" onClick={() => { if (confirm(`${plLabel(list)} を削除しますか？`)) onRemove(list); }}>削除</button>
        </td>
      </tr>)}</tbody>
    </table></div> : <p className="drawings-empty">{lists.length ? '検索条件に一致する40レベル部品はありません。' : '40レベル部品はまだ登録されていません。9桁目が 4 の番号のCSV・Excelを読み込むと、ここに並びます。'}</p>}
  </section>;
}
