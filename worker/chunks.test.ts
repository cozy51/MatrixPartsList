import { describe, expect, it } from 'vitest';
import { CHUNK_CHARS, splitChunks } from './chunks';

describe('D1へ保存するときの分割', () => {
  it('上限の文字数ごとに分け、つなげると元に戻る', () => {
    const text = 'あ'.repeat(CHUNK_CHARS * 2 + 5);
    const chunks = splitChunks(text);
    expect(chunks.map(chunk => chunk.length)).toEqual([CHUNK_CHARS, CHUNK_CHARS, 5]);
    expect(chunks.join('')).toBe(text);
  });
  it('サロゲートペア（絵文字など）の途中では切らない', () => {
    const text = 'a'.repeat(9) + '😀' + 'b';
    const chunks = splitChunks(text, 10);
    expect(chunks[0]).toBe('a'.repeat(9));
    expect(chunks.join('')).toBe(text);
  });
  it('空でも1つの塊にする', () => {
    expect(splitChunks('')).toEqual(['']);
  });
});
