import { describe, expect, it } from 'vitest';
import {
  buildDrawingLink,
  buildPartDrawingIndex,
  detectDrawingCategory,
  drawingCategoryOf,
  drawingsForPart,
  extractUrl,
  extractUrls,
  findExistingDrawing,
  isRegisterable,
  mergePartNos,
  normalizeDrawingNo,
  parseDrawingClipboard,
  parseDrawingClipboardAll,
  parseDrawingFileName,
  partNoCandidatesFromDrawingNo,
  partNoFromDrawingNo,
  removeDrawing,
  resolveFileUrl,
  searchDrawings,
  sortDrawings,
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
    expect(parseDrawingFileName('4397264_HH110A5060.pdf')).toEqual({ drawingNo: 'HH110A5060', docNo: '4397264', fileType: 'PDF' });
  });

  it('recognises DXF files', () => {
    expect(parseDrawingFileName('4397264_HH110A5060.dxf').fileType).toBe('DXF');
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
      fileType: 'PDF',
      category: '部品図',
      partNo: '',
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
    const unknown = buildDrawingLink({ url: 'https://example.com/', fileUrl: 'https://example.com/', fileName: '', drawingNo: '', docNo: '', fileType: 'その他', category: '', partNo: '' });
    expect(isRegisterable(unknown)).toBe(false);
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
    expect(partNoCandidatesFromDrawingNo('HD1AG0064204')).toEqual(['HD1AG00642', 'HD1AG00640']);
    expect(partNoFromDrawingNo('HD1AG0064204', ['HD1AG00642'])).toBe('HD1AG00642');
  });

  it('11桁の図番には機械図面と電気図面の2通りの品番候補がある', () => {
    expect(partNoCandidatesFromDrawingNo('HH010080430')).toEqual(['HH01008043', 'HH01008040']);
    // 10桁目が0なら、どちらの数え方でも同じ品番になる。
    expect(partNoCandidatesFromDrawingNo('HH110A00400')).toEqual(['HH110A0040']);
    expect(partNoCandidatesFromDrawingNo('HH110A5060')).toEqual([]);
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

  it('sorts by drawing number and file type', () => {
    const drawings = [drawing({ id: 'b', drawingNo: 'HH2' }), drawing({ id: 'c', drawingNo: 'HH1', fileType: 'DXF' }), drawing({ id: 'a', drawingNo: 'HH1' })];
    expect(sortDrawings(drawings).map(item => item.id)).toEqual(['c', 'a', 'b']);
  });
});
