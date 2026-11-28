/** D1の1つの値は約2MBまで。日本語（UTF-8で3バイト）でも収まるよう、文字数で分ける。 */
export const CHUNK_CHARS = 300_000;

/** JSONの文字列をD1に入る大きさに分ける。つなげると元に戻る。 */
export const splitChunks = (text: string, size = CHUNK_CHARS): string[] => {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    let end = Math.min(i + size, text.length);
    /* サロゲートペアの途中で切ると文字化けするため、1文字戻す。 */
    const code = text.charCodeAt(end - 1);
    if (end < text.length && code >= 0xd800 && code <= 0xdbff) end -= 1;
    out.push(text.slice(i, end));
    i = end - size;
  }
  return out.length ? out : [''];
};
