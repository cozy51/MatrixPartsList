import { describe, expect, it } from 'vitest';
import {
  buildPartDrawingIndex,
  drawingsForPart,
  extractUrl,
  mergePartNos,
  parseDrawingClipboard,
  parseDrawingFileName,
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
    });
  });

  it('returns undefined without a URL', () => {
    expect(parseDrawingClipboard('図面が見つかりません')).toBeUndefined();
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
