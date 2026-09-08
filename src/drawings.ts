/**
 * 図面リンクは部品表（PL）とは別のデータとして管理します。図番は品番と一致する
 * ことが多いものの、複数図面・流用図面では一致しないため、図番を主キーとし、
 * その図面を使う品番を配列で持たせて多対多の関係を表現します。
 */
export type DrawingLink = {
  id: string;
  /** 図番。品番と同じことが多いが、流用図面では異なる。 */
  drawingNo: string;
  /** 社内システムが払い出す管理番号（ファイル名の数値部分）。 */
  docNo: string;
  /** PDF / DXF など図面ファイルの種別。 */
  fileType: string;
  fileName: string;
  /** 社内システムからコピーしたリンク。認証のためプロキシURLのまま保持する。 */
  url: string;
  /** この図面を参照する品番。1つの図面を複数品番へ流用する場合に複数持つ。 */
  partNos: string[];
  note: string;
  updatedAt: string;
};

export type DrawingData = { revision: number; updatedAt: string; drawings: DrawingLink[] };

export const emptyDrawingData: DrawingData = {
  revision: 0,
  updatedAt: new Date(0).toISOString(),
  drawings: [],
};

export type ParsedDrawing = {
  url: string;
  fileUrl: string;
  fileName: string;
  drawingNo: string;
  docNo: string;
  fileType: string;
};

const FILE_TYPES: Record<string, string> = { pdf: 'PDF', dxf: 'DXF', dwg: 'DWG', tif: 'TIFF', tiff: 'TIFF' };

/** 図番・品番の比較は前後の空白と大文字小文字を無視する。 */
export const drawingKey = (value: string): string => value.trim().toUpperCase().replace(/\s+/g, '');

/** クリップボードの文字列からURLだけを取り出す。前後に説明文が付いていてもよい。 */
export function extractUrl(text: string): string {
  const found = text.match(/https?:\/\/[^\s"'<>]+/i)?.[0] ?? '';
  return found.replace(/[)\]},.;、。]+$/, '');
}

/**
 * 社内システムのリンクは `file.proxy?url=<実ファイル>` の形をとるため、図番を
 * 読み取る前に実ファイルのURLまで展開する。入れ子は数段までとする。
 */
export function resolveFileUrl(url: string): string {
  let current = url;
  for (let depth = 0; depth < 5; depth++) {
    let inner: string | null = null;
    try {
      inner = new URL(current).searchParams.get('url');
    } catch {
      return current;
    }
    if (!inner || !/^https?:\/\//i.test(inner) || inner === current) return current;
    current = inner;
  }
  return current;
}

function fileNameOf(url: string): string {
  try {
    const path = new URL(url).pathname;
    return decodeURIComponent(path.split('/').filter(Boolean).pop() ?? '');
  } catch {
    return '';
  }
}

/**
 * `4397264_HH110A5060.pdf` のようなファイル名から、英数字が混在するトークンを
 * 図番、数字だけのトークンを社内の管理番号として取り出す。
 */
export function parseDrawingFileName(fileName: string): { drawingNo: string; docNo: string; fileType: string } {
  const extension = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : '';
  const base = extension ? fileName.slice(0, -(extension.length + 1)) : fileName;
  const tokens = base.split(/[_\s-]+/).filter(Boolean);
  const named = tokens.filter(token => /[A-Za-z]/.test(token) && /\d/.test(token));
  const numeric = tokens.filter(token => /^\d+$/.test(token));
  return {
    drawingNo: (named.at(-1) ?? base).toUpperCase(),
    docNo: numeric[0] ?? '',
    fileType: FILE_TYPES[extension] ?? (extension ? extension.toUpperCase() : 'その他'),
  };
}

/** クリップボードの文字列を図面リンクの下書きへ変換する。URLがなければ undefined。 */
export function parseDrawingClipboard(text: string): ParsedDrawing | undefined {
  const url = extractUrl(text ?? '');
  if (!url) return undefined;
  const fileUrl = resolveFileUrl(url);
  const fileName = fileNameOf(fileUrl);
  return { url, fileUrl, fileName, ...parseDrawingFileName(fileName) };
}

export const isOpenableUrl = (url: string): boolean => /^https?:\/\//i.test(url.trim());

/** 品番から図面を引くための索引。1品番が複数図面を持つ場合は登録順に並ぶ。 */
export function buildPartDrawingIndex(drawings: DrawingLink[]): Map<string, DrawingLink[]> {
  const index = new Map<string, DrawingLink[]>();
  for (const drawing of drawings) {
    for (const partNo of drawing.partNos) {
      const key = drawingKey(partNo);
      if (!key) continue;
      const found = index.get(key);
      if (found) found.push(drawing); else index.set(key, [drawing]);
    }
  }
  return index;
}

export const drawingsForPart = (index: Map<string, DrawingLink[]>, partNo: string): DrawingLink[] =>
  index.get(drawingKey(partNo)) ?? [];

/** 品番の重複を除いて統合する。表記は先に登録された側を保持する。 */
export function mergePartNos(...groups: string[][]): string[] {
  const seen = new Map<string, string>();
  for (const group of groups) {
    for (const partNo of group) {
      const value = partNo.trim();
      if (value && !seen.has(drawingKey(value))) seen.set(drawingKey(value), value);
    }
  }
  return [...seen.values()];
}

/** 同じ図番・同じ種別の図面は1件にまとめ、対象品番は既存分と統合する。 */
export function upsertDrawing(drawings: DrawingLink[], entry: DrawingLink): DrawingLink[] {
  const identity = (drawing: DrawingLink) => `${drawingKey(drawing.drawingNo)} ${drawingKey(drawing.fileType)}`;
  const key = identity(entry);
  const existing = drawings.find(drawing => drawing.id === entry.id)
    ?? drawings.find(drawing => identity(drawing) === key);
  if (!existing) return [...drawings, entry];
  const merged: DrawingLink = { ...entry, id: existing.id, partNos: mergePartNos(existing.partNos, entry.partNos) };
  return drawings
    .map(drawing => drawing.id === existing.id ? merged : drawing)
    .filter(drawing => drawing.id === existing.id || identity(drawing) !== key);
}

export const removeDrawing = (drawings: DrawingLink[], id: string): DrawingLink[] =>
  drawings.filter(drawing => drawing.id !== id);

/** 図番・管理番号・品番・ファイル名・備考を対象にした絞り込み。 */
export function searchDrawings(drawings: DrawingLink[], query: string): DrawingLink[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return drawings;
  return drawings.filter(drawing => [drawing.drawingNo, drawing.docNo, drawing.fileName, drawing.note, ...drawing.partNos]
    .join(' ').toLowerCase().includes(needle));
}

export const sortDrawings = (drawings: DrawingLink[]): DrawingLink[] =>
  [...drawings].sort((a, b) =>
    drawingKey(a.drawingNo).localeCompare(drawingKey(b.drawingNo)) || a.fileType.localeCompare(b.fileType));
