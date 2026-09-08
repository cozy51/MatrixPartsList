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

/**
 * CAD ID は、図面を流用する先の品番を指します。材質違いなど見た目が変わらない
 * 場合に、社内システムの品番マスタで品番へCAD IDを登録して図面を共用します。
 * このアプリでは PL（9文字目が `1`）にだけ登録できるようにしています。
 */
export type CadIdLink = { partNo: string; cadId: string; updatedAt: string };

export type DrawingData = { revision: number; updatedAt: string; drawings: DrawingLink[]; cadIds?: CadIdLink[] };

export const emptyDrawingData: DrawingData = {
  revision: 0,
  updatedAt: new Date(0).toISOString(),
  drawings: [],
  cadIds: [],
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
  /** 図番から導いた品番のすべて。同じ基本番号の品番が複数ある場合に複数入る。 */
  partNos: string[];
};

/** 拡張子から種別を決める。社内システムの図面（PDF・DXF）と3Dモデル（eDrawings）に対応する。 */
const FILE_TYPES: Record<string, string> = {
  pdf: 'PDF', dxf: 'DXF', dwg: 'DWG', tif: 'TIFF', tiff: 'TIFF',
  easm: 'EASM', eprt: 'EPRT', edrw: 'EDRW', sldasm: 'SLDASM', sldprt: 'SLDPRT',
  step: 'STEP', stp: 'STEP', igs: 'IGES', iges: 'IGES',
};

/** eDrawingsなどの3Dモデル。図面と区別して表示する。 */
const MODEL_TYPES = new Set(['EASM', 'EPRT', 'EDRW', 'SLDASM', 'SLDPRT', 'STEP', 'IGES']);

export const isModelType = (fileType: string): boolean => MODEL_TYPES.has(fileType.trim().toUpperCase());

/** 表示順は 図面（PDF → DXF → DWG → TIFF）→ 3Dモデル → その他。 */
export function drawingTypeRank(fileType: string): number {
  const value = fileType.trim().toUpperCase();
  const order = ['PDF', 'DXF', 'DWG', 'TIFF'].indexOf(value);
  if (order >= 0) return order;
  return isModelType(value) ? 10 : 20;
}

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
 * 図番に結び付ける品番を決める。
 *
 * 1. 候補（先頭10桁／先頭9桁 + `0`）が部品表にあれば、それを使う。
 * 2. どちらも部品表になければ、同じ基本番号（先頭9桁）の品番を探す。図面や
 *    3Dモデルが新品番で登録され、部品表には旧品番が載っている場合に対応する。
 *    例: 3Dモデル `RJ0MT017440`（新品番 `RJ0MT01744`）と部品表の `RJ0MT01742`。
 * 3. それでも見つからなければ、機械図面の組図（先頭9桁 + `0`）として扱う。
 */
export function partNosForDrawing(drawingNo: string, knownPartNos: Iterable<string> = []): string[] {
  const candidates = partNoCandidatesFromDrawingNo(drawingNo);
  if (!candidates.length) return [];
  const known = [...new Set([...knownPartNos].map(drawingKey))];
  const exact = candidates.filter(candidate => known.includes(candidate));
  if (exact.length) return exact;
  const base = normalizeDrawingNo(drawingNo).slice(0, 9);
  const sameBase = known.filter(partNo => partNo.length === 10 && partNo.startsWith(base));
  return sameBase.length ? sameBase : [candidates[candidates.length - 1]];
}

/** 図番から導いた代表の品番。候補の選び方は partNosForDrawing と同じ。 */
export const partNoFromDrawingNo = (drawingNo: string, knownPartNos: Iterable<string> = []): string =>
  partNosForDrawing(drawingNo, knownPartNos)[0] ?? '';

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
  const partNos = partNosForDrawing(parsed.drawingNo, knownPartNos);
  return {
    url, fileUrl, fileName, ...parsed,
    category: detectDrawingCategory(parsed.drawingNo),
    partNo: partNos[0] ?? '',
    partNos,
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

/**
 * 図番の11桁目は枚数を表し、`0` が1枚目。同じ図面が複数枚に分かれている場合に、
 * 「1枚目」「2枚目」として選べるようにする。
 */
export function drawingSheetNo(drawingNo: string): number {
  const value = normalizeDrawingNo(drawingNo);
  return /^[A-Z][A-Z0-9]{8}\d{2}$/.test(value) ? Number(value[10]) : -1;
}

export function drawingSheetLabel(drawingNo: string): string {
  const sheet = drawingSheetNo(drawingNo);
  return sheet >= 0 ? `${sheet + 1}枚目` : '';
}

/**
 * 同じ種別（PDF・DXF・3Dモデル）の図面をひとまとめにする。複数枚ある場合は
 * バッジを1つにして、そこから枚数を選べるようにするために使う。
 */
export function groupDrawingsByType(items: ResolvedDrawing[]): { fileType: string; items: ResolvedDrawing[] }[] {
  const groups = new Map<string, ResolvedDrawing[]>();
  for (const item of items) {
    const key = item.drawing.fileType.trim().toUpperCase() || 'その他';
    const found = groups.get(key);
    if (found) found.push(item); else groups.set(key, [item]);
  }
  return [...groups.entries()]
    .map(([fileType, list]) => ({
      fileType,
      items: [...list].sort((a, b) => drawingSheetNo(a.drawing.drawingNo) - drawingSheetNo(b.drawing.drawingNo)
        || drawingKey(a.drawing.drawingNo).localeCompare(drawingKey(b.drawing.drawingNo))),
    }))
    .sort((a, b) => drawingTypeRank(a.fileType) - drawingTypeRank(b.fileType));
}

/** CAD IDを登録できるのはPL（9文字目が `1` の10桁番号）だけ。 */
export function isPlNumber(no: string): boolean {
  const value = normalizeDrawingNo(no);
  return /^[A-Z][A-Z0-9]{9}$/.test(value) && value[8] === '1';
}

export const cadIdFor = (cadIds: CadIdLink[], partNo: string): string =>
  cadIds.find(item => drawingKey(item.partNo) === drawingKey(partNo))?.cadId ?? '';

/** 同じ品番のCAD IDは1件だけ持つ。登録し直すと上書きする。 */
export function upsertCadId(cadIds: CadIdLink[], entry: CadIdLink): CadIdLink[] {
  const key = drawingKey(entry.partNo);
  const others = cadIds.filter(item => drawingKey(item.partNo) !== key);
  return [...others, entry];
}

export const removeCadId = (cadIds: CadIdLink[], partNo: string): CadIdLink[] =>
  cadIds.filter(item => drawingKey(item.partNo) !== drawingKey(partNo));

export const sortCadIds = (cadIds: CadIdLink[]): CadIdLink[] =>
  [...cadIds].sort((a, b) => drawingKey(a.partNo).localeCompare(drawingKey(b.partNo)));

/** 品番自身の図面と、CAD IDから流用する図面。流用分は viaCadId を持つ。 */
export type ResolvedDrawing = { drawing: DrawingLink; viaCadId?: string };

export function drawingsForPartWithCadId(index: Map<string, DrawingLink[]>, cadIds: CadIdLink[], partNo: string): ResolvedDrawing[] {
  const own: ResolvedDrawing[] = drawingsForPart(index, partNo).map(drawing => ({ drawing }));
  const cadId = cadIdFor(cadIds, partNo);
  if (!cadId || drawingKey(cadId) === drawingKey(partNo)) return own;
  const borrowed = drawingsForPart(index, cadId)
    .filter(drawing => !own.some(item => item.drawing.id === drawing.id))
    .map(drawing => ({ drawing, viaCadId: cadId }));
  return [...own, ...borrowed];
}

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
    partNos: mergePartNos(existing?.partNos ?? [], parsed.drawingNo ? [parsed.drawingNo] : [], parsed.partNos ?? (parsed.partNo ? [parsed.partNo] : [])),
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

/**
 * 自動登録の設定はブラウザーに保存し、どの画面から取り込んでも同じ扱いにする。
 * 既定はオン。キーに版を付けているのは、以前オフのまま保存された環境を一度
 * 既定へ戻すため（以降の変更はこのキーで保存される）。
 */
export const DRAWING_AUTO_REGISTER_KEY = 'matrix-parts-list.drawings.auto-register.v2';

export function isAutoRegisterEnabled(): boolean {
  try { return localStorage.getItem(DRAWING_AUTO_REGISTER_KEY) !== 'off'; } catch { return true; }
}

export function setAutoRegisterEnabled(value: boolean) {
  try { localStorage.setItem(DRAWING_AUTO_REGISTER_KEY, value ? 'on' : 'off'); } catch { /* 保存できなくても動作は変えない */ }
}

export type DrawingIntakeResult = {
  /** 登録後の図面リンク一覧。 */
  next: DrawingLink[];
  /** 登録・更新できたもの。 */
  done: { drawing: DrawingLink; isNew: boolean }[];
  /** 図番を判定できず、確認が必要なもの。 */
  pending: ParsedDrawing[];
};

/**
 * 貼り付けやクリップボードの文字列から図面リンクを取り込む。図番・リンク・
 * 対象品番がそろったものだけ登録し、判定できなかったものは確認へ回す。
 * 図面リンクタブとマトリックス部品表のどちらから取り込んでも同じ結果になる。
 */
export function registerDrawings(drawings: DrawingLink[], text: string, knownPartNos: Iterable<string> = []): DrawingIntakeResult {
  let next = drawings;
  const done: { drawing: DrawingLink; isNew: boolean }[] = [];
  const pending: ParsedDrawing[] = [];
  for (const parsed of parseDrawingClipboardAll(text, knownPartNos)) {
    const existing = findExistingDrawing(next, parsed);
    const entry = buildDrawingLink(parsed, existing);
    if (!isRegisterable(entry)) { pending.push(parsed); continue; }
    next = upsertDrawing(next, entry);
    done.push({ drawing: entry, isNew: !existing });
  }
  return { next, done, pending };
}

/** 図番・管理番号・品番・ファイル名・備考を対象にした絞り込み。 */
export function searchDrawings(drawings: DrawingLink[], query: string): DrawingLink[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return drawings;
  return drawings.filter(drawing => [drawing.drawingNo, drawing.docNo, drawing.fileName, drawing.note, drawingCategoryOf(drawing), ...drawing.partNos]
    .join(' ').toLowerCase().includes(needle));
}

export const sortDrawings = (drawings: DrawingLink[]): DrawingLink[] =>
  [...drawings].sort((a, b) => drawingKey(a.drawingNo).localeCompare(drawingKey(b.drawingNo))
    || drawingTypeRank(a.fileType) - drawingTypeRank(b.fileType)
    || a.fileType.localeCompare(b.fileType));
