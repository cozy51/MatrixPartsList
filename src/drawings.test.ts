import { describe, expect, it } from 'vitest';
import {
  buildDrawingLink,
  buildPartDrawingIndex,
  detectDrawingCategory,
  drawingCategoryOf,
  cadIdFor,
  drawingsForPart,
  drawingSheetLabel,
  drawingSheetName,
  drawingSheetNo,
  drawingsForPartWithCadId,
  extractUrl,
  extractUrls,
  findExistingDrawing,
  groupDrawingsByType,
  drawingTypeRank,
  isModelType,
  isPlNumber,
  isRegisterable,
  removeCadId,
  upsertCadId,
  mergePartNos,
  normalizeDrawingNo,
  parseDrawingClipboard,
  parseDrawingClipboardAll,
  parseDrawingFileName,
  partNoCandidatesFromDrawingNo,
  partNosForDrawing,
  versionedAssemblyPartNos,
  registerDrawings,
  partNoFromDrawingNo,
  removeDrawing,
  resolveFileUrl,
  searchDrawings,
  sortDrawings,
  summarizeDrawingIntake,
  upsertDrawing,
  type DrawingLink,
} from './drawings';

const PROXY_URL = 'https://lc-system-hybsog.muratec.co.jp/rg/jsp/file.proxy?url=https://lc-system-fsys.muratec.co.jp/drawing_mech32/main/pdf/HH1/4397264_HH110A5060.pdf';

const drawing = (overrides: Partial<DrawingLink> = {}): DrawingLink => ({
  id: 'id-1',
  drawingNo: 'HH110A5060',
  docNo: '4397264',
  fileType: 'PDF',
  fileName: '4397264_HH110A5060.pdf',
  url: PROXY_URL,
  partNos: ['HH110A5060'],
  note: '',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('extractUrl', () => {
  it('takes the URL out of surrounding text', () => {
    expect(extractUrl(`図面はこちら ${PROXY_URL} です。`)).toBe(PROXY_URL);
  });

  it('drops trailing punctuation copied with the link', () => {
    expect(extractUrl('https://example.com/a.pdf)')).toBe('https://example.com/a.pdf');
  });

  it('returns an empty string when no URL is present', () => {
    expect(extractUrl('HH110A5060')).toBe('');
  });
});

describe('resolveFileUrl', () => {
  it('unwraps the internal proxy URL', () => {
    expect(resolveFileUrl(PROXY_URL)).toBe('https://lc-system-fsys.muratec.co.jp/drawing_mech32/main/pdf/HH1/4397264_HH110A5060.pdf');
  });

  it('keeps a plain file URL as is', () => {
    expect(resolveFileUrl('https://example.com/a.pdf')).toBe('https://example.com/a.pdf');
  });
});

describe('parseDrawingFileName', () => {
  it('separates the drawing number from the internal document number', () => {
    expect(parseDrawingFileName('4397264_HH110A5060.pdf')).toEqual({ drawingNo: 'HH110A5060', docNo: '4397264', sheetNo: '', fileType: 'PDF' });
  });

  it('recognises DXF files', () => {
    expect(parseDrawingFileName('4397264_HH110A5060.dxf').fileType).toBe('DXF');
  });

  it('3Dモデル（eDrawings）の種別を判定する', () => {
    expect(parseDrawingFileName('5031809_HH11105B120.easm')).toEqual({ drawingNo: 'HH11105B120', docNo: '5031809', sheetNo: '', fileType: 'EASM' });
    // 同じ図番のeDrawingsが複数あるときは、ファイル名末尾の連番で見分ける。
    expect(parseDrawingFileName('4658515_HH121005400_1.easm')).toEqual({ drawingNo: 'HH121005400', docNo: '4658515', sheetNo: '1', fileType: 'EASM' });
    expect(parseDrawingFileName('4658515_HH121005400_2.easm')).toEqual({ drawingNo: 'HH121005400', docNo: '4658515', sheetNo: '2', fileType: 'EASM' });
    expect(parseDrawingFileName('5031809_HH11105B120.EPRT').fileType).toBe('EPRT');
  });

  it('falls back to the whole base name', () => {
    expect(parseDrawingFileName('drawing.pdf').drawingNo).toBe('DRAWING');
  });
});

describe('parseDrawingClipboard', () => {
  it('builds a draft from the copied internal system link', () => {
    expect(parseDrawingClipboard(`${PROXY_URL}\n`)).toEqual({
      url: PROXY_URL,
      fileUrl: 'https://lc-system-fsys.muratec.co.jp/drawing_mech32/main/pdf/HH1/4397264_HH110A5060.pdf',
      fileName: '4397264_HH110A5060.pdf',
      drawingNo: 'HH110A5060',
      docNo: '4397264',
      sheetNo: '',
      fileType: 'PDF',
      category: '部品図',
      partNo: '',
      partNos: [],
    });
  });

  it('組立図のリンクからは、図番と対応する品番の両方を得る', () => {
    const parsed = parseDrawingClipboard('https://lc-system-fsys.muratec.co.jp/drawing_mech32/main/pdf/HH1/5053111_HH110A00410.pdf');
    expect(parsed).toMatchObject({ drawingNo: 'HH110A00410', docNo: '5053111', category: '組立図', partNo: 'HH110A0040' });
  });

  it('用紙サイズ付きのリンクは、図番から用紙サイズを外して読み取る', () => {
    const parsed = parseDrawingClipboard('https://lc-system-fsys.muratec.co.jp/drawing_mech32/main/pdf/HD1/1602903_HD1AG0064204.pdf', ['HD1AG00642']);
    expect(parsed).toMatchObject({ drawingNo: 'HD1AG006420', docNo: '1602903', category: '組立図', partNo: 'HD1AG00642' });
  });

  it('returns undefined without a URL', () => {
    expect(parseDrawingClipboard('図面が見つかりません')).toBeUndefined();
  });
});

describe('まとめ貼り付けと自動登録', () => {
  const ASSEMBLY = 'https://lc-system-fsys.muratec.co.jp/drawing_mech32/main/pdf/HH1/5053111_HH110A00410.pdf';
  const PART = 'https://lc-system-fsys.muratec.co.jp/drawing_mech32/main/pdf/HH0/2898465_HH01002L61_4.pdf';

  it('複数行のリンクを重複なく取り出す', () => {
    expect(extractUrls(`${ASSEMBLY}\n${PART}\n${ASSEMBLY}`)).toEqual([ASSEMBLY, PART]);
    expect(extractUrls('リンクなし')).toEqual([]);
  });

  it('まとめて貼り付けた分をすべて下書きへ変換する', () => {
    expect(parseDrawingClipboardAll(`${ASSEMBLY} ${PART}`).map(item => item.drawingNo)).toEqual(['HH110A00410', 'HH01002L61']);
  });

  it('確認なしで登録できるレコードを組み立てる', () => {
    const entry = buildDrawingLink(parseDrawingClipboardAll(ASSEMBLY)[0]);
    expect(entry).toMatchObject({ drawingNo: 'HH110A00410', category: '組立図', partNos: ['HH110A00410', 'HH110A0040'] });
    expect(isRegisterable(entry)).toBe(true);
    // 図番を判定できないリンクは自動登録せず、確認へ回す。
    const unknown = buildDrawingLink({ url: 'https://example.com/', fileUrl: 'https://example.com/', fileName: '', drawingNo: '', docNo: '', sheetNo: '', fileType: 'その他', category: '', partNo: '', partNos: [] });
    expect(isRegisterable(unknown)).toBe(false);
  });

  it('登録できるものだけ登録し、判定できないものは確認へ回す', () => {
    const result = registerDrawings([], `${ASSEMBLY}\n${PART}\nhttps://example.com/`, ['HH110A0040']);
    expect(result.done.map(item => item.drawing.drawingNo)).toEqual(['HH110A00410', 'HH01002L61']);
    expect(result.done.every(item => item.isNew)).toBe(true);
    expect(result.next).toHaveLength(2);
    expect(result.pending).toHaveLength(1);
    // 図番から導いた品番は、部品表に実在する側を選ぶ。
    expect(result.done[0].drawing.partNos).toContain('HH110A0040');
  });

  it('同じリンクを取り込み直すと更新になり、登録件数は増えない', () => {
    const first = registerDrawings([], ASSEMBLY);
    const second = registerDrawings(first.next, ASSEMBLY);
    expect(second.next).toHaveLength(1);
    expect(second.done.map(item => item.isNew)).toEqual([false]);
    // 内容が変わっていないことも分かるようにする。
    expect(second.done.map(item => item.changed)).toEqual([false]);
  });

  it('同じ図番で管理番号が変わったときは更新として扱う', () => {
    const first = registerDrawings([], ASSEMBLY);
    const renewed = ASSEMBLY.replace('5053111_', '5099999_');
    const second = registerDrawings(first.next, renewed);
    expect(second.next).toHaveLength(1);
    expect(second.done.map(item => item.isNew)).toEqual([false]);
    expect(second.done.map(item => item.changed)).toEqual([true]);
    expect(summarizeDrawingIntake(second)).toMatchObject({ added: 0, updated: 1, unchanged: 0, ok: true });
  });

  it('取り込み結果は、登録できたときもできなかったときもメッセージにする', () => {
    const added = summarizeDrawingIntake(registerDrawings([], ASSEMBLY));
    expect(added.added).toBe(1);
    expect(added.ok).toBe(true);
    expect(added.message).toContain('図面リンクを1件登録しました');

    // すでに同じ内容で登録済みのときは、追加できなかったことを伝える。
    const again = summarizeDrawingIntake(registerDrawings(registerDrawings([], ASSEMBLY).next, ASSEMBLY));
    expect(again).toMatchObject({ added: 0, updated: 0, unchanged: 1, ok: false });
    expect(again.message).toContain('すでに同じ内容で登録済み');

    // 図番を判定できないリンクが混ざったときも、確認が必要だと伝える。
    const partly = summarizeDrawingIntake(registerDrawings([], `${PART}\nhttps://example.com/`));
    expect(partly).toMatchObject({ added: 1, pending: 1, ok: false });
    expect(partly.message).toContain('図番を判定できませんでした');

    // リンクが1つもないときは、その旨を伝える。
    expect(summarizeDrawingIntake(registerDrawings([], 'メモだけ')).message).toContain('取り込める図面リンクがありませんでした');
  });

  it('取り込み直しは既存レコードの更新になる', () => {
    const parsed = parseDrawingClipboardAll(PART)[0];
    const first = buildDrawingLink(parsed);
    const registered = upsertDrawing([], first);
    const existing = findExistingDrawing(registered, parsed);
    expect(existing?.id).toBe(first.id);
    // 備考など、手で入れた内容は引き継ぐ。
    const kept = upsertDrawing(registered, buildDrawingLink(parsed, { ...first, note: '流用元あり' }));
    expect(kept).toHaveLength(1);
    expect(kept[0].note).toBe('流用元あり');
  });
});

describe('3Dモデル', () => {
  it('図面と3Dモデルを見分ける', () => {
    expect(isModelType('EASM')).toBe(true);
    expect(isModelType('easm')).toBe(true);
    expect(isModelType('PDF')).toBe(false);
  });

  it('表示順は 図面 → 3Dモデル → その他', () => {
    expect(['EASM', 'その他', 'DXF', 'PDF'].sort((a, b) => drawingTypeRank(a) - drawingTypeRank(b))).toEqual(['PDF', 'DXF', 'EASM', 'その他']);
  });

  it('3Dモデルのリンクも同じ手順で取り込める', () => {
    const parsed = parseDrawingClipboard('https://lc-system-fsys.muratec.co.jp/drawing_mech32/main/eDrawings/HH1/5031809_HH11105B120.easm', ['HH11105B10']);
    expect(parsed).toMatchObject({ drawingNo: 'HH11105B120', docNo: '5031809', fileType: 'EASM', partNo: 'HH11105B10' });
    const entry = buildDrawingLink(parsed!);
    expect(isRegisterable(entry)).toBe(true);
    expect(entry.partNos).toEqual(['HH11105B120', 'HH11105B10']);
  });

  it('同じ図番でも、図面と3Dモデルは別レコードとして残す', () => {
    const pdf = drawing({ id: 'pdf', drawingNo: 'HH11105B120', fileType: 'PDF' });
    const model = drawing({ id: 'easm', drawingNo: 'HH11105B120', fileType: 'EASM' });
    const result = upsertDrawing([pdf], model);
    expect(result.map(item => item.fileType)).toEqual(['PDF', 'EASM']);
    expect(sortDrawings(result).map(item => item.fileType)).toEqual(['PDF', 'EASM']);
  });
});

describe('図面区分と図番からの品番', () => {
  it('9文字目のコードで組立図と部品図を見分ける', () => {
    expect(detectDrawingCategory('HH110A0040')).toBe('組立図');
    expect(detectDrawingCategory('HH110A00410')).toBe('組立図');
    expect(detectDrawingCategory('HH11000010')).toBe('組立図');
    expect(detectDrawingCategory('HH110A5060')).toBe('部品図');
    expect(detectDrawingCategory('HH3101AQ52')).toBe('部品図');
    expect(detectDrawingCategory('Z074963100')).toBe('');
    expect(detectDrawingCategory('HH110')).toBe('');
  });

  it('登録済みの区分を優先する', () => {
    expect(drawingCategoryOf(drawing({ drawingNo: 'HH110A5060' }))).toBe('部品図');
    expect(drawingCategoryOf(drawing({ drawingNo: 'HH110A5060', category: '組立図' }))).toBe('組立図');
  });

  it('11桁の図番から10桁の品番を導く', () => {
    // 機械図面の組図: 図番 = 品番の先頭9桁 + Ver + 枚数。品番の10桁目は0のまま。
    expect(partNoFromDrawingNo('HH110A00410')).toBe('HH110A0040');
    expect(partNoFromDrawingNo('hh110a00421')).toBe('HH110A0040');
    // 10桁の図番（図番＝品番）は変換しない。
    expect(partNoFromDrawingNo('HH110A5060')).toBe('');
    expect(partNoFromDrawingNo('')).toBe('');
  });

  it('12桁目の用紙サイズは図番に含めない', () => {
    // HD1AG0064204 = 図番 HD1AG006420（11桁目 0 が1枚目）+ 用紙サイズ 4（A4）。
    expect(normalizeDrawingNo('HD1AG0064204')).toBe('HD1AG006420');
    expect(normalizeDrawingNo('hd1ag0064204')).toBe('HD1AG006420');
    // 11桁・10桁の図番はそのまま。
    expect(normalizeDrawingNo('HH110A00410')).toBe('HH110A00410');
    expect(normalizeDrawingNo('HH110A5060')).toBe('HH110A5060');
  });

  it('用紙サイズ付きの図番からも品番を導く', () => {
    // HD1 は電気図面の機種CDのため、候補は先頭10桁の1つに決まる。
    expect(partNoCandidatesFromDrawingNo('HD1AG0064204')).toEqual(['HD1AG00642']);
    expect(partNoFromDrawingNo('HD1AG0064204', ['HD1AG00642'])).toBe('HD1AG00642');
    // 機械図面は従来どおり2通りの候補を持つ。
    expect(partNoCandidatesFromDrawingNo('HH1AG0064204')).toEqual(['HH1AG00642', 'HH1AG00640']);
  });

  it('電気図面（機種CD HD1）は、改訂前の品番へ結び付けない', () => {
    // 図番 HD1FE051420 の品番は HD1FE05142。HD1FE05140（改訂前）ではない。
    expect(partNoCandidatesFromDrawingNo('HD1FE051420')).toEqual(['HD1FE05142']);
    expect(partNosForDrawing('HD1FE051420', ['HD1FE05140', 'HD1FE05142'])).toEqual(['HD1FE05142']);
    // 部品表に品番がなくても、先頭9桁 + 0 へは広げない。
    expect(partNosForDrawing('HD1FE051420', ['HD1FE05140'])).toEqual(['HD1FE05142']);
    // 同じ形の機械図面は、これまでどおり部品表にある品番を選ぶ。
    expect(partNosForDrawing('HH1FE051420', ['HH1FE05140', 'HH1FE05142'])).toEqual(['HH1FE05142', 'HH1FE05140']);
    // 10桁の図番の読み替え（品番の先頭9桁 + Ver）も電気図面では行わない。
    expect(versionedAssemblyPartNos('HD1FE05142', ['HD1FE05140'])).toEqual([]);
  });

  it('電気図面の図番で誤って登録された対象品番は、品番から引かせない', () => {
    // 以前の版は HD1FE051420 を HD1FE05140 にも結び付けていた。
    const link = drawing({ id: 'ele', drawingNo: 'HD1FE051420', partNos: ['HD1FE051420', 'HD1FE05142', 'HD1FE05140'] });
    const index = buildPartDrawingIndex([link]);
    expect(drawingsForPart(index, 'HD1FE05142')).toEqual([link]);
    expect(drawingsForPart(index, 'HD1FE05140')).toEqual([]);
    // 同じ図番そのものからは引ける。
    expect(drawingsForPart(index, 'HD1FE051420')).toEqual([link]);
  });

  it('11桁の図番には機械図面と電気図面の2通りの品番候補がある', () => {
    expect(partNoCandidatesFromDrawingNo('HH010080430')).toEqual(['HH01008043', 'HH01008040']);
    // 10桁目が0なら、どちらの数え方でも同じ品番になる。
    expect(partNoCandidatesFromDrawingNo('HH110A00400')).toEqual(['HH110A0040']);
    expect(partNoCandidatesFromDrawingNo('HH110A5060')).toEqual([]);
  });

  it('候補が部品表にないときは、同じ基本番号の品番へ結び付ける', () => {
    // 3Dモデルが新品番 RJ0MT01744 で登録され、部品表には旧品番 RJ0MT01742 がある場合。
    expect(partNosForDrawing('RJ0MT017440', ['RJ0MT01742'])).toEqual(['RJ0MT01742']);
    expect(partNoFromDrawingNo('RJ0MT017440', ['RJ0MT01742'])).toBe('RJ0MT01742');
    // 候補そのものが部品表にあるときは広げない（別Verの品番へは付けない）。
    expect(partNosForDrawing('HH010080430', ['HH01008043', 'HH01008041'])).toEqual(['HH01008043']);
    // 基本番号が違う品番は対象にしない。
    expect(partNosForDrawing('RJ0MT017440', ['RJ0MT09992'])).toEqual(['RJ0MT01740']);
  });

  it('10桁の図番（品番の先頭9桁 + Ver）は、部品表にある品番へ読み替える', () => {
    // PL HH13112010 の組図。枚数は11桁目ではなく、ファイル名末尾の _1 に入る。
    expect(partNosForDrawing('HH13112012', ['HH13112010'])).toEqual(['HH13112010']);
    expect(partNoFromDrawingNo('HH13112012', ['HH13112010'])).toBe('HH13112010');
    // 読み替え先が部品表になければ、図番のままにする（図番＝品番として扱う）。
    expect(partNosForDrawing('HH13112012', ['HH13111010'])).toEqual([]);
  });

  it('10桁の図番を読み替えるのは、取り違えのおそれがない場合だけ', () => {
    // 部品図の10桁目は材質違いを表す品番の一部。別部品へ付けない。
    expect(versionedAssemblyPartNos('HH33108M51', ['HH33108M50'])).toEqual([]);
    // 電気図面は品番そのものの10桁目を上げる。部品表にある番号はそのまま品番。
    expect(versionedAssemblyPartNos('HH01008043', ['HH01008043', 'HH01008040'])).toEqual([]);
    // 10桁目が0なら読み替え先が同じ番号になるため、何もしない。
    expect(versionedAssemblyPartNos('HH13112010', ['HH13112010'])).toEqual([]);
    // 11桁の図番は従来どおりの読み替え（この関数の対象外）。
    expect(versionedAssemblyPartNos('HH131120120', ['HH13112010'])).toEqual([]);
  });

  it('10桁の図番で登録済みの図面も、部品表の品番からたどれる', () => {
    const link = drawing({ id: 'ver', drawingNo: 'HH13112012', sheetNo: '1', partNos: ['HH13112012'] });
    // 取り込み直さなくても、索引の側で品番へ読み替える。
    expect(drawingsForPart(buildPartDrawingIndex([link]), 'HH13112010')).toEqual([]);
    expect(drawingsForPart(buildPartDrawingIndex([link], ['HH13112010']), 'HH13112010')).toEqual([link]);
  });

  it('電気図面は、部品表に実在する品番を優先して選ぶ', () => {
    // 電気図面は品番はそのままで、図番の11桁目を上げる（HH01008043 → HH010080430）。
    expect(partNoFromDrawingNo('HH010080430', ['HH01008043', 'HH01008041'])).toBe('HH01008043');
    // 機械図面の組図は、先頭9桁 + 0 の品番が実在する。
    expect(partNoFromDrawingNo('HH110A00410', ['HH110A0040'])).toBe('HH110A0040');
    // どちらも実在しなければ、従来どおり機械図面の組図として扱う。
    expect(partNoFromDrawingNo('HH010080430', ['ZZ00000000'])).toBe('HH01008040');
  });
});

describe('part index', () => {
  it('finds every drawing of a part regardless of case', () => {
    const index = buildPartDrawingIndex([
      drawing(),
      drawing({ id: 'id-2', drawingNo: 'HH110A5061', partNos: ['HH110A5060', 'HH110A5061'] }),
    ]);
    expect(drawingsForPart(index, 'hh110a5060').map(item => item.id)).toEqual(['id-1', 'id-2']);
    expect(drawingsForPart(index, 'HH110A5061').map(item => item.id)).toEqual(['id-2']);
    expect(drawingsForPart(index, 'HH0000000')).toEqual([]);
  });

  it('11桁の図番で登録した組立図を、10桁の品番から引ける', () => {
    const assembly = drawing({ id: 'asm', drawingNo: 'HH110A00410', partNos: ['HH110A00410'] });
    const index = buildPartDrawingIndex([assembly]);
    expect(drawingsForPart(index, 'HH110A0040').map(item => item.id)).toEqual(['asm']);
    expect(drawingsForPart(index, 'HH110A00410').map(item => item.id)).toEqual(['asm']);
    // 同じ図面を二重に返さない。
    const both = buildPartDrawingIndex([drawing({ id: 'asm2', drawingNo: 'HH110A00410', partNos: ['HH110A00410', 'HH110A0040'] })]);
    expect(drawingsForPart(both, 'HH110A0040')).toHaveLength(1);
  });

  it('用紙サイズ付きで登録済みの図面も、10桁の品番から引ける', () => {
    const sized = drawing({ id: 'sized', drawingNo: 'HD1AG0064204', partNos: ['HD1AG0064204'] });
    expect(drawingsForPart(buildPartDrawingIndex([sized]), 'HD1AG00642').map(item => item.id)).toEqual(['sized']);
  });

  it('電気図面の11桁図番も、10桁の品番から引ける', () => {
    // 図番 HH010080430（電気図面）は品番 HH01008043 のもの。
    const electric = drawing({ id: 'ele', drawingNo: 'HH010080430', partNos: ['HH010080430'] });
    const index = buildPartDrawingIndex([electric]);
    expect(drawingsForPart(index, 'HH01008043').map(item => item.id)).toEqual(['ele']);
  });
});

describe('upsertDrawing', () => {
  it('adds a new drawing', () => {
    expect(upsertDrawing([], drawing())).toHaveLength(1);
  });

  it('merges part numbers when the same drawing number and type is registered again', () => {
    const result = upsertDrawing([drawing()], drawing({ id: 'id-2', partNos: ['HH110A5061'] }));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('id-1');
    expect(result[0].partNos).toEqual(['HH110A5060', 'HH110A5061']);
  });

  it('keeps a different file type of the same drawing as its own entry', () => {
    const result = upsertDrawing([drawing()], drawing({ id: 'id-2', fileType: 'DXF' }));
    expect(result.map(item => item.fileType)).toEqual(['PDF', 'DXF']);
  });

  it('updates the edited entry in place', () => {
    const result = upsertDrawing([drawing(), drawing({ id: 'id-2', drawingNo: 'HH110A5061' })], drawing({ note: '流用図面' }));
    expect(result).toHaveLength(2);
    expect(result[0].note).toBe('流用図面');
  });
});

describe('helpers', () => {
  it('merges part numbers without duplicates', () => {
    expect(mergePartNos(['HH1', ' HH2 '], ['hh1', ''])).toEqual(['HH1', 'HH2']);
  });

  it('removes a drawing by id', () => {
    expect(removeDrawing([drawing(), drawing({ id: 'id-2' })], 'id-1').map(item => item.id)).toEqual(['id-2']);
  });

  it('searches drawing numbers, part numbers and notes', () => {
    const drawings = [drawing(), drawing({ id: 'id-2', drawingNo: 'HH110A9999', fileName: '4397265_HH110A9999.pdf', partNos: ['HH110A9999'], note: '流用' })];
    expect(searchDrawings(drawings, '5060').map(item => item.id)).toEqual(['id-1']);
    expect(searchDrawings(drawings, '流用').map(item => item.id)).toEqual(['id-2']);
    expect(searchDrawings(drawings, '')).toHaveLength(2);
  });

  it('図番順に並べ、同じ図番では PDF → DXF → 3Dモデル の順にする', () => {
    const drawings = [
      drawing({ id: 'b', drawingNo: 'HH2' }),
      drawing({ id: 'c', drawingNo: 'HH1', fileType: 'DXF' }),
      drawing({ id: 'd', drawingNo: 'HH1', fileType: 'EASM' }),
      drawing({ id: 'a', drawingNo: 'HH1' }),
    ];
    expect(sortDrawings(drawings).map(item => item.id)).toEqual(['a', 'c', 'd', 'b']);
  });
});

describe('CAD ID（図面の流用）', () => {
  const cadIds = [{ partNo: 'HH11002010', cadId: 'HH11001010', updatedAt: '2026-01-01T00:00:00.000Z' }];

  it('CAD IDを登録できるのはPL（9文字目が1）だけ', () => {
    expect(isPlNumber('HH11002010')).toBe(true);
    expect(isPlNumber('hh11001010')).toBe(true);
    // 9文字目が4・6の番号（組図・部品図）は対象外。
    expect(isPlNumber('HH110A0040')).toBe(false);
    expect(isPlNumber('HH110A5060')).toBe(false);
    // 11桁の図番も対象外。
    expect(isPlNumber('HH110A00410')).toBe(false);
  });

  it('品番ごとに1件だけ持ち、登録し直すと上書きする', () => {
    const updated = upsertCadId(cadIds, { partNo: 'hh11002010', cadId: 'HH11003010', updatedAt: '2026-02-01T00:00:00.000Z' });
    expect(updated).toHaveLength(1);
    expect(cadIdFor(updated, 'HH11002010')).toBe('HH11003010');
    expect(removeCadId(updated, 'HH11002010')).toEqual([]);
    expect(cadIdFor(cadIds, 'HH99999010')).toBe('');
  });

  it('CAD IDの図面を流用として返す', () => {
    const shared = drawing({ id: 'shared', drawingNo: 'HH11001010', partNos: ['HH11001010'] });
    const index = buildPartDrawingIndex([shared]);
    const resolved = drawingsForPartWithCadId(index, cadIds, 'HH11002010');
    expect(resolved).toEqual([{ drawing: shared, viaCadId: 'HH11001010' }]);
    // CAD IDを持たない品番はそのまま。
    expect(drawingsForPartWithCadId(index, cadIds, 'HH11001010')).toEqual([{ drawing: shared }]);
  });

  it('自分の図面を先に、CAD IDからの流用を後に並べ、重複は除く', () => {
    const own = drawing({ id: 'own', drawingNo: 'HH11002010', partNos: ['HH11002010'] });
    const shared = drawing({ id: 'shared', drawingNo: 'HH11001010', partNos: ['HH11001010', 'HH11002010'] });
    const resolved = drawingsForPartWithCadId(buildPartDrawingIndex([own, shared]), cadIds, 'HH11002010');
    // 対象品番に直接登録済みの図面は、流用としては重ねて返さない。
    expect(resolved.map(item => [item.drawing.id, item.viaCadId ?? ''])).toEqual([['own', ''], ['shared', '']]);
  });
});

describe('同じ種別の図面が複数枚あるとき', () => {
  const sheet = (n: number) => drawing({ id: `sheet-${n}`, drawingNo: `HJ02100015${n}`, fileName: `409616${n}_HJ02100015${n}.pdf`, partNos: ['HJ021000150'] });

  it('図番の11桁目から「n枚目」を求める', () => {
    expect(drawingSheetNo('HJ021000150')).toBe(0);
    expect(drawingSheetLabel('HJ021000150')).toBe('1枚目');
    expect(drawingSheetLabel('HJ021000154')).toBe('5枚目');
    // 用紙サイズ付きの12桁でも、11桁に直してから見る。
    expect(drawingSheetLabel('HD1AG0064204')).toBe('1枚目');
    // 10桁の品番には枚数がない。
    expect(drawingSheetNo('HH110A5060')).toBe(-1);
    expect(drawingSheetLabel('HH110A5060')).toBe('');
  });

  it('種別ごとにまとめ、枚数の順に並べる', () => {
    const model = drawing({ id: 'model', drawingNo: 'HJ021000150', fileType: 'EASM', fileName: '5409416_HJ0210001500.easm' });
    const groups = groupDrawingsByType([sheet(2), model, sheet(0), sheet(1)].map(item => ({ drawing: item })));
    // 種別はPDFを先に、同じ種別の中は1枚目から並べる。
    expect(groups.map(group => [group.fileType, group.items.length])).toEqual([['PDF', 3], ['EASM', 1]]);
    expect(groups[0].items.map(item => item.drawing.id)).toEqual(['sheet-0', 'sheet-1', 'sheet-2']);
  });

  it('CAD IDから流用した図面もまとめる', () => {
    expect(groupDrawingsByType([{ drawing: sheet(0), viaCadId: 'HJ021000140' }])[0].items[0].viaCadId).toBe('HJ021000140');
  });
});

describe('同じ図番・同じ種別で複数ファイルあるとき', () => {
  const easm = (sheet: string) => ({
    id: `easm-${sheet}`,
    drawingNo: 'HH121005400',
    docNo: '4658515',
    sheetNo: sheet,
    fileType: 'EASM',
    fileName: `4658515_HH121005400_${sheet}.easm`,
    url: `https://lc-system-fsys.muratec.co.jp/drawing_mech32/main/eDrawings/HH1/4658515_HH121005400_${sheet}.easm`,
    partNos: ['HH121005400'],
    note: '',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  it('連番が違えば上書きせず、別の図面として残す', () => {
    const registered = upsertDrawing(upsertDrawing([], easm('1')), easm('2'));
    expect(registered.map(item => item.fileName)).toEqual(['4658515_HH121005400_1.easm', '4658515_HH121005400_2.easm']);
    // 同じ連番を取り込み直したときは、これまでどおり更新にする。
    expect(upsertDrawing(registered, { ...easm('2'), id: 'other', note: '流用' })).toHaveLength(2);
  });

  it('取り込みで2件とも登録する', () => {
    const base = 'https://lc-system-hybsog.muratec.co.jp/rg/jsp/file.proxy?url=https://lc-system-fsys.muratec.co.jp/drawing_mech32/main/eDrawings/HH1';
    const { next, done } = registerDrawings([], `${base}/4658515_HH121005400_1.easm\n${base}/4658515_HH121005400_2.easm`, ['HH12100540']);
    expect(next).toHaveLength(2);
    expect(done.every(item => item.isNew)).toBe(true);
    expect(next.map(item => item.sheetNo)).toEqual(['1', '2']);
  });

  it('連番から「n枚目」を求め、種別ごとにまとめて並べる', () => {
    expect(drawingSheetName(easm('1'))).toBe('1枚目');
    expect(drawingSheetName(easm('2'))).toBe('2枚目');
    // 連番がなければ、これまでどおり図番の11桁目を使う。
    expect(drawingSheetName({ drawingNo: 'HJ021000151' })).toBe('2枚目');
    const groups = groupDrawingsByType([{ drawing: easm('2') }, { drawing: easm('1') }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map(item => item.drawing.sheetNo)).toEqual(['1', '2']);
  });

  it('同じ品番から2件とも引ける', () => {
    const index = buildPartDrawingIndex([easm('1'), easm('2')]);
    expect(drawingsForPart(index, 'HH12100540').map(item => item.id)).toEqual(['easm-1', 'easm-2']);
  });
});

describe('Verが英字の図番（9の次はA）', () => {
  it('10桁目が英字でも、図番として読み取って品番へ結び付ける', () => {
    // 品番 HH12302010 の組図。10桁目のVerが C、11桁目の 0〜4 が枚数。
    expect(partNoCandidatesFromDrawingNo('HH1230201C0')).toEqual(['HH1230201C', 'HH12302010']);
    expect(partNosForDrawing('HH1230201C0', ['HH12302010'])).toEqual(['HH12302010']);
    expect(partNoFromDrawingNo('HH1230201C4', ['HH12302010'])).toBe('HH12302010');
    // 用紙サイズ付きの12桁も、Verが英字のまま11桁へそろえる。
    expect(normalizeDrawingNo('HH1230201C04')).toBe('HH1230201C0');
  });

  it('枚数も英字のVerを飛ばして読み取る', () => {
    expect(drawingSheetLabel('HH1230201C0')).toBe('1枚目');
    expect(drawingSheetLabel('HH1230201C4')).toBe('5枚目');
  });

  it('リンクからそのまま登録できる', () => {
    const base = 'https://lc-system-hybsog.muratec.co.jp/rg/jsp/file.proxy?url=https://lc-system-fsys.muratec.co.jp/drawing_mech32/main/pdf/HH1';
    const { next, done, pending } = registerDrawings([], [0, 1, 2, 3, 4].map(n => `${base}/538257${n}_HH1230201C${n}.pdf`).join('\n'), ['HH12302010']);
    expect(pending).toEqual([]);
    expect(done).toHaveLength(5);
    expect(next).toHaveLength(5);
    expect(next[0]).toMatchObject({ drawingNo: 'HH1230201C0', category: '組立図', partNos: ['HH1230201C0', 'HH12302010'] });
  });
});
