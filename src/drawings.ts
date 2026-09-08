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
  /** 図面区分（組立図・部品図）。番号から自動判定し、必要なら手で直せる。 */
  category?: string;
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
  category: string;
  /** 図番から導いた品番。組立図など、図番と品番が異なる場合だけ値が入る。 */
  partNo: string;
};

const FILE_TYPES: Record<string, string> = { pdf: 'PDF', dxf: 'DXF', dwg: 'DWG', tif: 'TIFF', tiff: 'TIFF' };

/** 図番・品番の比較は前後の空白と大文字小文字を無視する。 */
export const drawingKey = (value: string): string => value.trim().toUpperCase().replace(/\s+/g, '');

export const DRAWING_CATEGORIES = ['組立図', '部品図'] as const;

/**
 * 図番・品番の9文字目は図面区分を表し、1・4が組立図、5・6が部品図になる。
 * 例: 組立図 HH110A0040 / HH110A00410、部品図 HH110A5060。
 */
const CATEGORY_CODES: Record<string, string> = { '1': '組立図', '4': '組立図', '5': '部品図', '6': '部品図' };

export function detectDrawingCategory(no: string): string {
  const value = drawingKey(no);
  return value.length >= 9 ? CATEGORY_CODES[value[8]] ?? '' : '';
}

/** 保存済みの区分を優先し、未設定なら図番から判定する。 */
export const drawingCategoryOf = (drawing: Pick<DrawingLink, 'drawingNo'> & { category?: string }): string =>
  drawing.category?.trim() || detectDrawingCategory(drawing.drawingNo);

/**
 * 図番の12桁目は用紙サイズ（`4` = A4）を表し、図面そのものを指す番号ではない。
 * 例: `HD1AG0064204` は図番 `HD1AG006420`（11桁目 `0` が1枚目）＋ 用紙サイズ `4`。
 * 画面には出さず、品番の判定にも使わないため、11桁までを図番として扱う。
 */
export function normalizeDrawingNo(value: string): string {
  const key = drawingKey(value);
  return /^[A-Z][A-Z0-9]{8}\d{3}$/.test(key) ? key.slice(0, 11) : key;
}

/**
 * 11桁の図番に対応する10桁の品番の候補を返す。11桁になる理由は2通りあり、
 * 図番だけでは見分けられないため、両方を候補として持つ。
 *
 * - 機械図面の組図: 品番の10桁目は `0` のままで、図番の10桁目がVer、11桁目が
 *   枚数（品番 `HH110A0040` → 図番 `HH110A00410`）。
 * - 電気図面: 外注のため品番そのものの10桁目を改訂で上げるので、図番はその
 *   品番に枚数の1桁を足した形になる（品番 `HH01008043` → 図番 `HH010080430`）。
 */
export function partNoCandidatesFromDrawingNo(drawingNo: string): string[] {
  const value = normalizeDrawingNo(drawingNo);
  if (!/^[A-Z][A-Z0-9]{8}\d{2}$/.test(value)) return [];
  return [...new Set([value.slice(0, 10), `${value.slice(0, 9)}0`])];
}

/**
 * 図番から品番を導く。候補が2つある場合は、部品表に実在する品番を優先し、
 * 判断できないときは機械図面の組図（先頭9桁 + `0`）として扱う。
 */
export function partNoFromDrawingNo(drawingNo: string, knownPartNos: Iterable<string> = []): string {
  const candidates = partNoCandidatesFromDrawingNo(drawingNo);
  if (!candidates.length) return '';
  const known = new Set([...knownPartNos].map(drawingKey));
  return candidates.find(candidate => known.has(candidate)) ?? candidates[candidates.length - 1];
}

/** クリップボードの文字列からURLだけを取り出す。前後に説明文が付いていてもよい。 */
export function extractUrl(text: string): string {
  return extractUrls(text)[0] ?? '';
}

/** 複数行に貼り付けられたリンクをまとめて取り出す。重複は1件にする。 */
export function extractUrls(text: string): string[] {
  const found = (text ?? '').match(/https?:\/\/[^\s"'<>]+/gi) ?? [];
  return [...new Set(found.map(url => url.replace(/[)\]},.;、。]+$/, '')))];
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
    drawingNo: normalizeDrawingNo(named.at(-1) ?? base),
    docNo: numeric[0] ?? '',
    fileType: FILE_TYPES[extension] ?? (extension ? extension.toUpperCase() : 'その他'),
  };
}

/** 1件のリンクを図面リンクの下書きへ変換する。品番の候補は部品表の品番で絞る。 */
export function parseDrawingUrl(url: string, knownPartNos: Iterable<string> = []): ParsedDrawing {
  const fileUrl = resolveFileUrl(url);
  const fileName = fileNameOf(fileUrl);
  const parsed = parseDrawingFileName(fileName);
  return {
    url, fileUrl, fileName, ...parsed,
    category: detectDrawingCategory(parsed.drawingNo),
    partNo: partNoFromDrawingNo(parsed.drawingNo, knownPartNos),
  };
}

/** クリップボードの文字列を図面リンクの下書きへ変換する。URLがなければ undefined。 */
export function parseDrawingClipboard(text: string, knownPartNos: Iterable<string> = []): ParsedDrawing | undefined {
  const url = extractUrl(text ?? '');
  return url ? parseDrawingUrl(url, knownPartNos) : undefined;
}

/** 貼り付けられた文字列に含まれるリンクをすべて下書きへ変換する。 */
export const parseDrawingClipboardAll = (text: string, knownPartNos: Iterable<string> = []): ParsedDrawing[] =>
  extractUrls(text).map(url => parseDrawingUrl(url, knownPartNos));

export const isOpenableUrl = (url: string): boolean => /^https?:\/\//i.test(url.trim());

/**
 * 品番から図面を引くための索引。1品番が複数図面を持つ場合は登録順に並ぶ。
 * 対象品番に加えて、11桁の図番から導いた品番でも引けるようにするため、
 * 図番＝品番で登録した組立図も部品表からたどれる。
 */
export function buildPartDrawingIndex(drawings: DrawingLink[]): Map<string, DrawingLink[]> {
  const index = new Map<string, DrawingLink[]>();
  const add = (value: string, drawing: DrawingLink) => {
    const key = drawingKey(value);
    if (!key) return;
    const found = index.get(key);
    if (!found) index.set(key, [drawing]);
    else if (!found.includes(drawing)) found.push(drawing);
  };
  for (const drawing of drawings) {
    for (const partNo of drawing.partNos) add(partNo, drawing);
    // 図番だけで登録された図面も引けるよう、11桁の図番から導いた品番の候補を
    // すべて索引へ入れる（機械図面の組図と電気図面で導き方が異なるため）。
    for (const no of [drawing.drawingNo, ...drawing.partNos]) {
      for (const candidate of partNoCandidatesFromDrawingNo(no)) add(candidate, drawing);
    }
  }
  return index;
}

export const drawingsForPart = (index: Map<string, DrawingLink[]>, partNo: string): DrawingLink[] =>
  index.get(drawingKey(partNo)) ?? [];

/** 図番と種別が一致する既存の図面。取り込み直しは新規ではなく更新として扱う。 */
export const findExistingDrawing = (drawings: DrawingLink[], parsed: ParsedDrawing): DrawingLink | undefined =>
  drawings.find(drawing => drawing.url === parsed.url
    || (drawingKey(drawing.drawingNo) === drawingKey(parsed.drawingNo) && drawingKey(drawing.fileType) === drawingKey(parsed.fileType)));

/**
 * 取り込んだ内容から、そのまま登録できる図面リンクを組み立てる。組立図は図番と
 * 品番が異なるため、図番から導いた品番も対象品番へ入れる。
 */
export function buildDrawingLink(parsed: ParsedDrawing, existing?: DrawingLink): DrawingLink {
  return {
    id: existing?.id ?? crypto.randomUUID(),
    drawingNo: parsed.drawingNo,
    docNo: parsed.docNo,
    fileType: parsed.fileType,
    category: existing?.category?.trim() || parsed.category,
    fileName: parsed.fileName,
    url: parsed.url,
    partNos: mergePartNos(existing?.partNos ?? [], parsed.drawingNo ? [parsed.drawingNo] : [], parsed.partNo ? [parsed.partNo] : []),
    note: existing?.note ?? '',
    updatedAt: new Date().toISOString(),
  };
}

/** 図番・リンク・対象品番がそろっていれば、確認なしで登録できる。 */
export const isRegisterable = (entry: Pick<DrawingLink, 'drawingNo' | 'url' | 'partNos'>): boolean =>
  Boolean(entry.drawingNo.trim() && entry.url.trim() && entry.partNos.length);

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
  return drawings.filter(drawing => [drawing.drawingNo, drawing.docNo, drawing.fileName, drawing.note, drawingCategoryOf(drawing), ...drawing.partNos]
    .join(' ').toLowerCase().includes(needle));
}

export const sortDrawings = (drawings: DrawingLink[]): DrawingLink[] =>
  [...drawings].sort((a, b) =>
    drawingKey(a.drawingNo).localeCompare(drawingKey(b.drawingNo)) || a.fileType.localeCompare(b.fileType));
