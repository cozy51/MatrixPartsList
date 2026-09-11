/**
 * 品番・PL番号の9桁目は、部品の階層（レベル）を表します。10桁・11桁の番号だけが対象です。
 *
 * - `1` … **10レベル**。ユニットの部品表（PL）。マトリックス部品表に並べて比較します。
 * - `4` … **40レベル**。分解できる部品（組立図）。PLと同じようにリストを読み込めますが、
 *   どのユニットに属するかは決まっていないため、マトリックスには並べません。
 *   10レベルの明細に出てくる40レベルの品番から、その中身を開いて確認します。
 * - `5`・`6` … **50/60レベル**。これ以上分解しない部品。
 */
export type PartLevel = '10' | '40' | '5060' | '';

const LEVEL_BY_CODE: Record<string, PartLevel> = { '1': '10', '4': '40', '5': '5060', '6': '5060' };

/** 番号の9桁目から階層を返す。10桁・11桁の番号でないときは空文字。 */
export function partLevelOf(no: string): PartLevel {
  const value = (no ?? '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]{9,10}$/.test(value)) return '';
  return LEVEL_BY_CODE[value[8]] ?? '';
}

/** 画面に出す階層の呼び名。 */
export const partLevelLabel = (no: string): string => {
  const level = partLevelOf(no);
  return level ? `${level === '5060' ? '50/60' : level}レベル` : '';
};

/** 10レベル（PL）の番号かどうか。 */
export const isPlLevelNo = (no: string): boolean => partLevelOf(no) === '10';

/** 40レベル（分解できる部品）の番号かどうか。 */
export const isLevel40No = (no: string): boolean => partLevelOf(no) === '40';

/** 同じ番号どうしを結び付けるためのキー。大文字・前後の空白の違いを無視する。 */
export const levelNoKey = (no: string): string => (no ?? '').trim().toUpperCase();
