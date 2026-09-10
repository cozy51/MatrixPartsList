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
  /** ファイル名の末尾に付く連番（`..._1.easm` の `1`）。同じ図番で複数枚あるときに入る。 */
  sheetNo?: string;
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
  sheetNo: string;
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
 * 11桁の図番のうち、11桁目が枚数（数字）のもの。10桁目はVerで、`0`〜`9` の次は
 * `A`・`B`・`C` と英字へ繰り上がる（`HH1230201C0`）。
 */
const DRAWING_NO_11_SHEET = /^[A-Z][A-Z0-9]{9}\d$/;

/**
 * 11桁目が `T` の図番は**追加工図**。素材の品番（10桁）へ追加工した部品の図面で、
 * 11桁目は枚数ではなく追加工の印になる（品番 `HH16001063` → 追加工図
 * `HH16001063T`）。10桁目まではそのまま品番なので、Verとして読み替えない。
 */
const DRAWING_NO_11_MACHINING = /^[A-Z][A-Z0-9]{9}T$/;

/** 11桁の図番。11桁目は枚数（数字）か、追加工図の `T`。 */
const DRAWING_NO_11 = /^[A-Z][A-Z0-9]{9}[\dT]$/;

/** 追加工図（11桁目が `T`）かどうか。 */
export const isAdditionalMachiningDrawingNo = (drawingNo: string): boolean =>
  DRAWING_NO_11_MACHINING.test(normalizeDrawingNo(drawingNo));

/**
 * 品番が11桁のものがある（銘板の `NP14734361B` など、11桁目が英字）。11桁目は
 * 枚数なら必ず数字、追加工図なら `T` なので、それ以外の英字が来たら11桁全体が
 * 品番だと分かる。この品番の図番は、そこへ1桁足した12桁になる
 * （品番 `NP14734361B` → 図番 `NP14734361B3`）。
 */
const LONG_PART_NO = /^[A-Z][A-Z0-9]{9}[A-SU-Z]$/;
const LONG_PART_DRAWING_NO = /^[A-Z][A-Z0-9]{9}[A-SU-Z]\d$/;

/** 11桁の品番そのもの（図番ではない）かどうか。 */
export const isLongPartNo = (no: string): boolean => LONG_PART_NO.test(drawingKey(no));

/** 11桁の品番に1桁足した12桁の図番かどうか。 */
export const isLongPartDrawingNo = (drawingNo: string): boolean => LONG_PART_DRAWING_NO.test(drawingKey(drawingNo));

/**
 * 図番の12桁目は用紙サイズ（`4` = A4）を表し、図面そのものを指す番号ではない。
 * 例: `HD1AG0064204` は図番 `HD1AG006420`（11桁目 `0` が1枚目）＋ 用紙サイズ `4`。
 * 画面には出さず、品番の判定にも使わないため、11桁までを図番として扱う。
 * 追加工図（11桁目が `T`）に用紙サイズが付く場合も同じように切り落とす。
 */
export function normalizeDrawingNo(value: string): string {
  const key = drawingKey(value);
  return /^[A-Z][A-Z0-9]{9}[\dT]\d$/.test(key) ? key.slice(0, 11) : key;
}

/**
 * 11桁の図番に対応する10桁の品番の候補を返す。11桁になる理由は2通りあり、
 * 図番だけでは見分けられないため、両方を候補として持つ。
 *
 * - 機械図面の組図: 品番の10桁目は `0` のままで、図番の10桁目がVer、11桁目が
 *   枚数（品番 `HH110A0040` → 図番 `HH110A00410`）。Verは `9` の次が `A` の
 *   英字になるため、10桁目は数字とは限らない（品番 `HH12302010` → 図番
 *   `HH1230201C0`）。
 * - 電気図面: 外注のため品番そのものの10桁目を改訂で上げるので、図番はその
 *   品番に枚数の1桁を足した形になる（品番 `HH01008043` → 図番 `HH010080430`）。
 *
 * 追加工図（11桁目が `T`）だけは枚数の桁がなく、10桁目までがそのまま品番なので、
 * 候補は1つに決まる（図番 `HH16001063T` → 品番 `HH16001063`）。
 *
 * 品番が11桁のもの（11桁目が `T` 以外の英字）は、図番が12桁になる。この場合は
 * 先頭11桁がそのまま品番で、候補は1つに決まる
 * （図番 `NP14734361B3` → 品番 `NP14734361B`）。
 */
export function partNoCandidatesFromDrawingNo(drawingNo: string): string[] {
  const value = normalizeDrawingNo(drawingNo);
  // 11桁の品番の図番。10桁の品番として読むと、別の品番へ結び付いてしまう。
  if (LONG_PART_DRAWING_NO.test(value)) return [value.slice(0, 11)];
  if (!DRAWING_NO_11.test(value)) return [];
  // 追加工図は10桁目までが品番。Verとして読み替えると別品番へ結び付いてしまう。
  if (DRAWING_NO_11_MACHINING.test(value)) return [value.slice(0, 10)];
  // 電気図面は数え方が1通りに決まるため、機械図面の組図の候補は持たせない。
  if (isElectricalDrawingNo(value)) return [value.slice(0, 10)];
  return [...new Set([value.slice(0, 10), `${value.slice(0, 9)}0`])];
}

/**
 * 電気図面の機種CD（品番・図番の先頭3文字）。電気図面は外注のため、品番そのものの
 * 10桁目を改訂で上げ、図番は「品番（10桁）+ 枚数（1桁）」になる。機械図面の組図の
 * ように「先頭9桁 + `0`」の品番へも読み替えると、改訂前の別品番へ誤って結び付く。
 * 例: 図番 `HD1FE051420` の品番は `HD1FE05142` であり、`HD1FE05140` ではない。
 */
export const ELECTRICAL_MACHINE_CODES = new Set(['HD1']);

export const isElectricalDrawingNo = (no: string): boolean =>
  ELECTRICAL_MACHINE_CODES.has(drawingKey(no).slice(0, 3));

/** 電気図面の図番から、機械図面の組図として誤って導かれる品番（先頭9桁 + `0`）。 */
export function mechanicalMisreadPartNo(drawingNo: string): string {
  const value = normalizeDrawingNo(drawingNo);
  if (!DRAWING_NO_11.test(value) || !isElectricalDrawingNo(value)) return '';
  const misread = `${value.slice(0, 9)}0`;
  return misread === value.slice(0, 10) ? '' : misread;
}

/**
 * 10桁の図番のうち、組立図（9文字目が `1`・`4`）で10桁目が `0` でないものは、
 * 「品番の先頭9桁 + Ver」の形をとることがある。枚数は11桁目ではなく、ファイル名
 * 末尾の連番に入る（PL `HH13112010` の図番 `HH13112012`、ファイル名
 * `4944716_HH13112012_1.pdf`）。この場合は先頭9桁 + `0` が品番になる。
 *
 * ただし電気図面は品番そのものの10桁目を改訂で上げるため（品番 `HH01008043`）、
 * 10桁目が `0` でないだけでは見分けられない。取り違えないよう、図番そのものが
 * 部品表にない場合に限り、部品表にある「先頭9桁 + `0`」の品番だけを返す。
 * 部品図（9文字目が `5`・`6`）の10桁目は材質違いを表す品番の一部なので対象外。
 */
export const versionedAssemblyPartNos = (drawingNo: string, knownPartNos: Iterable<string> = []): string[] =>
  versionedAssemblyPartNosOf(drawingNo, knownPartNoKeys(knownPartNos));

/** 品番の集合。図番を何度も突き合わせるため、呼ぶ側で1回だけ作れるようにする。 */
const knownPartNoKeys = (knownPartNos: Iterable<string>): Set<string> => new Set([...knownPartNos].map(drawingKey));

function versionedAssemblyPartNosOf(drawingNo: string, known: Set<string>): string[] {
  const value = normalizeDrawingNo(drawingNo);
  if (!/^[A-Z][A-Z0-9]{9}$/.test(value) || value.endsWith('0')) return [];
  if (isElectricalDrawingNo(value)) return [];
  if (detectDrawingCategory(value) !== '組立図' || known.has(value)) return [];
  const base = `${value.slice(0, 9)}0`;
  return known.has(base) ? [base] : [];
}

/**
 * 図番の `#` は、その桁が品番ごとに変わることを表す**多品一葉図**の印。
 * 長さ違いなど、1枚の図面で複数の品番をまかなう図面に使われる。
 * 例: 図番 `MVS570##60`（図面の品番欄は `MVS-570##-60`、品名 RAIL/DIN）は、
 * `MVS5700160`・`MVS5700260` など7・8桁目だけが違う品番の共通図面。
 * `#` を任意の1文字として、部品表にある品番の中から一致するものを返す。
 */
export const wildcardPartNos = (drawingNo: string, knownPartNos: Iterable<string> = []): string[] =>
  wildcardPartNosOf(drawingNo, knownPartNoKeys(knownPartNos));

function wildcardPartNosOf(drawingNo: string, known: Set<string>): string[] {
  const value = normalizeDrawingNo(drawingNo);
  if (!value.includes('#')) return [];
  const pattern = new RegExp(`^${[...value].map(char => char === '#' ? '[A-Z0-9]' : char.replace(/[^A-Z0-9]/, '\\$&')).join('')}$`);
  return [...known].filter(partNo => pattern.test(partNo)).sort();
}

/**
 * 図番に結び付ける品番を決める。
 *
 * 0. 11桁でない図番は、「品番の先頭9桁 + Ver」の10桁の図番かどうかを見る。
 *    電気図面（機種CDが `HD1` など）は候補が先頭10桁の1つに決まるため、
 *    部品表になくてもその品番を返し、2.の探索はしない。
 * 1. 候補（先頭10桁／先頭9桁 + `0`）が部品表にあれば、それを使う。
 * 2. どちらも部品表になければ、同じ基本番号（先頭9桁）の品番を探す。図面や
 *    3Dモデルが新品番で登録され、部品表には旧品番が載っている場合に対応する。
 *    例: 3Dモデル `RJ0MT017440`（新品番 `RJ0MT01744`）と部品表の `RJ0MT01742`。
 * 3. それでも見つからなければ、機械図面の組図（先頭9桁 + `0`）として扱う。
 */
export function partNosForDrawing(drawingNo: string, knownPartNos: Iterable<string> = []): string[] {
  // 多品一葉図（`#` を含む図番）は、部品表にある品番へそのまま結び付ける。
  const wildcard = wildcardPartNos(drawingNo, knownPartNos);
  if (wildcard.length) return wildcard;
  const candidates = partNoCandidatesFromDrawingNo(drawingNo);
  if (!candidates.length) return versionedAssemblyPartNos(drawingNo, knownPartNos);
  const known = [...new Set([...knownPartNos].map(drawingKey))];
  const exact = candidates.filter(candidate => known.includes(candidate));
  if (exact.length) return exact;
  // 電気図面は「品番 + 枚数」で品番が決まるため、基本番号を広げて探さない。
  if (isElectricalDrawingNo(drawingNo)) return candidates;
  // 11桁の品番も「品番 + 1桁」で決まるため、10桁の品番へ広げて探さない。
  if (LONG_PART_DRAWING_NO.test(normalizeDrawingNo(drawingNo))) return candidates;
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
    // 図番に `#` を含む共通図面があるため、URLの断片記号と混ざらないよう符号化して持つ。
    current = inner.replace(/#/g, '%23');
  }
  return current;
}

function fileNameOf(url: string): string {
  try {
    const path = new URL(url.replace(/#/g, '%23')).pathname;
    return decodeURIComponent(path.split('/').filter(Boolean).pop() ?? '');
  } catch {
    return '';
  }
}

/**
 * `4397264_HH110A5060.pdf` のようなファイル名から、英数字が混在するトークンを
 * 図番、数字だけのトークンを社内の管理番号として取り出す。
 */
export function parseDrawingFileName(fileName: string): { drawingNo: string; docNo: string; sheetNo: string; fileType: string } {
  const extension = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : '';
  const base = extension ? fileName.slice(0, -(extension.length + 1)) : fileName;
  const tokens = base.split(/[_\s-]+/).filter(Boolean);
  const named = tokens.filter(token => /[A-Za-z]/.test(token) && /\d/.test(token));
  const numeric = tokens.filter(token => /^\d+$/.test(token));
  // 図番の後ろに続く数字は、同じ図番の何枚目かを表す連番（`4658515_HH121005400_2.easm`）。
  const drawingNoAt = tokens.lastIndexOf(named.at(-1) ?? '');
  const sheetNo = drawingNoAt >= 0 ? tokens.slice(drawingNoAt + 1).find(token => /^\d+$/.test(token)) ?? '' : '';
  return {
    drawingNo: normalizeDrawingNo(named.at(-1) ?? base),
    docNo: numeric[0] ?? '',
    sheetNo,
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
export function buildPartDrawingIndex(drawings: DrawingLink[], knownPartNos: Iterable<string> = []): Map<string, DrawingLink[]> {
  const index = new Map<string, DrawingLink[]>();
  const known = knownPartNoKeys(knownPartNos);
  const add = (value: string, drawing: DrawingLink) => {
    const key = drawingKey(value);
    if (!key) return;
    const found = index.get(key);
    if (!found) index.set(key, [drawing]);
    else if (!found.includes(drawing)) found.push(drawing);
  };
  for (const drawing of drawings) {
    // 以前の版が電気図面の図番から誤って導いた品番は、保存済みでも引かせない。
    const misread = drawingKey(mechanicalMisreadPartNo(drawing.drawingNo));
    for (const partNo of drawing.partNos) if (!misread || drawingKey(partNo) !== misread) add(partNo, drawing);
    // 図番だけで登録された図面も引けるよう、11桁の図番から導いた品番の候補を
    // すべて索引へ入れる（機械図面の組図と電気図面で導き方が異なるため）。
    for (const no of [drawing.drawingNo, ...drawing.partNos]) {
      for (const candidate of partNoCandidatesFromDrawingNo(no)) add(candidate, drawing);
      // 「品番の先頭9桁 + Ver」の10桁の図番は、登録済みの図面でも品番から引けるようにする。
      for (const candidate of versionedAssemblyPartNosOf(no, known)) add(candidate, drawing);
      // 多品一葉図（`#` を含む図番）は、部品表の品番からも引けるようにする。
      for (const candidate of wildcardPartNosOf(no, known)) add(candidate, drawing);
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
  // 追加工図の `T` は枚数ではないため、枚数なしとして扱う。
  return DRAWING_NO_11_SHEET.test(value) ? Number(value[10]) : -1;
}

export function drawingSheetLabel(drawingNo: string): string {
  const sheet = drawingSheetNo(drawingNo);
  return sheet >= 0 ? `${sheet + 1}枚目` : '';
}

/**
 * 何枚目かの並び順。ファイル名の連番（`..._2.easm`）があればそれを優先し、
 * なければ図番の11桁目を使う。どちらも無ければ -1。
 */
export function drawingSheetIndex(drawing: Pick<DrawingLink, 'drawingNo' | 'sheetNo'>): number {
  const suffix = Number(drawing.sheetNo);
  if (drawing.sheetNo?.trim() && Number.isFinite(suffix) && suffix > 0) return suffix - 1;
  return drawingSheetNo(drawing.drawingNo);
}

/**
 * 「n枚目」の表示。連番と図番のどちらからでも求める。追加工図は枚数ではなく
 * 「追加工」と出し、同じ品番の元の図面と見分けられるようにする。
 */
export function drawingSheetName(drawing: Pick<DrawingLink, 'drawingNo' | 'sheetNo'>): string {
  const index = drawingSheetIndex(drawing);
  const sheet = index >= 0 ? `${index + 1}枚目` : '';
  if (!isAdditionalMachiningDrawingNo(drawing.drawingNo)) return sheet;
  return sheet ? `追加工 ${sheet}` : '追加工';
}

/** 並び順で追加工図を後ろに回すための重み。 */
const machiningRank = (drawingNo: string): number => (isAdditionalMachiningDrawingNo(drawingNo) ? 1 : 0);

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
      // 追加工図は元の図面のあとに置く。枚数がないため、そのままだと先頭に来てしまう。
      items: [...list].sort((a, b) => machiningRank(a.drawing.drawingNo) - machiningRank(b.drawing.drawingNo)
        || drawingSheetIndex(a.drawing) - drawingSheetIndex(b.drawing)
        || drawingKey(a.drawing.drawingNo).localeCompare(drawingKey(b.drawing.drawingNo))
        || a.drawing.fileName.localeCompare(b.drawing.fileName)),
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

/**
 * 同じ図番・同じ種別でも、ファイル名の連番が違えば別の図面（2枚目・3枚目）。
 * 上書きしてしまわないよう、連番まで含めて同一かどうかを判断する。
 */
export const drawingIdentity = (drawing: Pick<DrawingLink, 'drawingNo' | 'fileType' | 'sheetNo'>): string =>
  `${drawingKey(drawing.drawingNo)} ${drawingKey(drawing.fileType)} ${(drawing.sheetNo ?? '').trim()}`;

export const findExistingDrawing = (drawings: DrawingLink[], parsed: ParsedDrawing): DrawingLink | undefined =>
  drawings.find(drawing => drawing.url === parsed.url || drawingIdentity(drawing) === drawingIdentity(parsed));

/**
 * 取り込んだ内容から、そのまま登録できる図面リンクを組み立てる。組立図は図番と
 * 品番が異なるため、図番から導いた品番も対象品番へ入れる。
 */
export function buildDrawingLink(parsed: ParsedDrawing, existing?: DrawingLink): DrawingLink {
  return {
    id: existing?.id ?? crypto.randomUUID(),
    drawingNo: parsed.drawingNo,
    docNo: parsed.docNo,
    sheetNo: parsed.sheetNo,
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
  const identity = drawingIdentity;
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
  /** 登録・更新できたもの。`changed` は既存の内容から変わったかどうか。 */
  done: { drawing: DrawingLink; isNew: boolean; changed: boolean }[];
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
  const done: DrawingIntakeResult['done'] = [];
  const pending: ParsedDrawing[] = [];
  for (const parsed of parseDrawingClipboardAll(text, knownPartNos)) {
    const existing = findExistingDrawing(next, parsed);
    const entry = buildDrawingLink(parsed, existing);
    if (!isRegisterable(entry)) { pending.push(parsed); continue; }
    next = upsertDrawing(next, entry);
    // 対象品番は既存分と統合されるため、保存後の内容と比べて変化の有無を判断する。
    const saved = next.find(drawing => drawing.id === entry.id) ?? entry;
    done.push({ drawing: saved, isNew: !existing, changed: !existing || !isSameDrawingContent(existing, saved) });
  }
  return { next, done, pending };
}

/** 取り込みの結果を、利用者へ伝える1つのメッセージにまとめる。 */
export type DrawingIntakeSummary = {
  /** 新しく登録できた件数。 */
  added: number;
  /** 既存の図面リンクの内容を更新できた件数。 */
  updated: number;
  /** すでに同じ内容で登録済みだった件数。 */
  unchanged: number;
  /** 図番を判定できず、確認が必要な件数。 */
  pending: number;
  /** すべて登録・更新できたかどうか。false のときは理由をメッセージで伝える。 */
  ok: boolean;
  message: string;
};

/**
 * 取り込み結果の内訳を数え、そのままメッセージとして出せる文にする。
 * 追加できたときだけでなく、追加できなかったときも必ず理由を伝えるため、
 * マトリックス部品表と図面リンクタブの両方でこの文を使う。
 */
export function summarizeDrawingIntake(result: DrawingIntakeResult): DrawingIntakeSummary {
  const added = result.done.filter(item => item.isNew).length;
  const updated = result.done.filter(item => !item.isNew && item.changed).length;
  const unchanged = result.done.length - added - updated;
  const pending = result.pending.length;
  const names = result.done
    .filter(item => item.isNew || item.changed)
    .map(item => `${normalizeDrawingNo(item.drawing.drawingNo)}（${item.drawing.fileType}）`);
  const lines: string[] = [];
  if (added || updated) lines.push(`図面リンクを${added + updated}件登録しました（新規 ${added}件 / 更新 ${updated}件）: ${names.join('、')}`);
  if (unchanged) lines.push(`${unchanged}件はすでに同じ内容で登録済みのため、追加していません。`);
  if (pending) lines.push(`${pending}件は図番を判定できませんでした。「図面リンク」タブで内容を確認して登録してください。`);
  if (!lines.length) lines.push('取り込める図面リンクがありませんでした。社内システムで図面・3Dモデルのリンクをコピーしてください。');
  return { added, updated, unchanged, pending, ok: added + updated > 0 && !unchanged && !pending, message: lines.join(' ') };
}

/** 更新日時を除いた内容が同じかどうか。取り込み時に「変更なし」を見分けるために使う。 */
export const isSameDrawingContent = (a: DrawingLink, b: DrawingLink): boolean =>
  a.drawingNo === b.drawingNo && a.docNo === b.docNo && (a.sheetNo ?? '') === (b.sheetNo ?? '')
  && a.fileType === b.fileType && (a.category ?? '') === (b.category ?? '')
  && a.fileName === b.fileName && a.url === b.url && a.note === b.note
  && a.partNos.length === b.partNos.length && a.partNos.every((partNo, index) => partNo === b.partNos[index]);

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
