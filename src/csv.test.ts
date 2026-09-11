import{describe,expect,it,vi}from'vitest';import{extractPlVersion,findDuplicatePls,isValidPlVersion,findRegisteredPlIds,normalizePlVersion,parseCsv,parsePartsList,partKey,removeDeletedParts,plIdentityKey,plLabel,widenedSheetRange}from'./csv';
vi.stubGlobal('crypto',{randomUUID:()=> 'id'});
const sample=`機構別部品明細表,,,,\nPLNO,HH110A0010,,PL名称,DRIVE GEAR BOX (350M3)\n,,,,\n出指,改廃,風船,品番,Ver.,品名,数量,単位,材質・メーカー,Size\n,D,9,DELETED,1,DELETED PART,1,,STEEL,\n,,1,HH110A0040,2,INITIAL WHEEL,1,,SUS,\n,,3,,,HCZr M5X10,2,,,,\n,,C,,,三菱支給品,,,,`;
describe('CSV parser',()=>{it('quoted comma',()=>expect(parseCsv('a,"b,c"\n')[0]).toEqual(['a','b,c']));
it('セルの途中の引用符は文字として読み、あとの行を落とさない',()=>{/* 1/2" のような表記で囲みが始まると、以降の明細が丸ごと消えてしまう。 */
  expect(parseCsv('a,b"c,d\n1,2,3\n')).toEqual([['a','b"c','d'],['1','2','3']]);
  /* 囲みが閉じないまま終わるファイルでも、行数は保つ。 */
  expect(parseCsv('a,"b,c\n1,2,3\n')).toEqual([['a','"b','c'],['1','2','3']]);
  /* 正しく囲まれたセルは、これまでどおり中身のカンマ・改行・引用符を保つ。 */
  expect(parseCsv('a,"b,c",d\n')[0]).toEqual(['a','b,c','d']);
  expect(parseCsv('a,"b""c"\n')[0]).toEqual(['a','b"c']);
  expect(parseCsv('a,"b\nc"\n2\n')).toEqual([['a','b\nc'],['2']])});
it('明細の途中に引用符があっても、そのあとの明細まで読み込む',()=>{const text=[
  '機構別部品明細表,,,,','PLNO,HJ02102010,,PL名称,HOIST UNIT',',,,,',
  '出指,改廃,風船,品番,Ver.,品名,数量,単位,材質・メーカー,Size',
  ',,15,Z075319400,,CBL-CLAMP CTAM1,3,,ヘラマンタイトン,',
  ',,16,HJ02173060,,FRAME/FRONT 1/2" PLATE,1,,A5052P-H34,',
  ',,17,HJ02174061,,BRACKET/FRAME,1,,SUS304-CP,',
  ',,18,HJ02175060,,FRAME/REAR,1,,A5052P-H34,'].join('\n');
  const parsed=parsePartsList(text,'HJ02102010_5.csv');
  expect(parsed.parts.map(part=>part.balloon)).toEqual(['15','16','17','18']);
  /* 引用符を含む明細も、品名・数量・材質がずれない。 */
  expect(parsed.parts[1].name).toBe('FRAME/FRONT 1/2" PLATE');
  expect(parsed.parts[1].quantity).toBe('1');
  expect(parsed.parts[1].material).toBe('A5052P-H34')});it('detects metadata/header and normalizes blank part number',()=>{const p=parsePartsList(sample,'HH110A0010_2.csv');expect(p.plNo).toBe('HH110A0010');expect(p.plName).toContain('DRIVE');expect(p.plVersion).toBe('2');expect(p.machineId).toBe('SRC350');expect(p.modeId).toBe('01');expect(normalizePlVersion('v5')).toBe('05');expect(plLabel(p)).toBe('HH110A0010 v02');expect(plLabel({...p,plVersion:'v11'})).toBe('HH110A0010 v11');expect(plIdentityKey(p)).toBe(plIdentityKey({...p,plNo:'hh110a0010',plVersion:'v02'}));expect(findDuplicatePls([p],[{...p,id:'duplicate',plVersion:'v02'}]).get('duplicate')).toContain('登録済み');expect(findRegisteredPlIds([p],[{...p,id:'duplicate',plVersion:'v02'},{...p,id:'new',plNo:'NEW',plVersion:'v02'}])).toEqual(new Set(['duplicate']));expect(findDuplicatePls([p],[{...p,id:'other-machine',machineId:'HU300',plVersion:'v02'}])).toHaveLength(0);expect(p.parts).toHaveLength(3);expect(p.parts.some(part=>part.partNo==='DELETED')).toBe(false);expect(p.parts[1].partNo).toBe('+');expect(removeDeletedParts([{...p,parts:[...p.parts,{...p.parts[0],changeStatus:' d '}]}])[0].parts).toHaveLength(3)});it('extracts versions from supported file names',()=>{expect(extractPlVersion('HH3101K810_11.xlsx')).toBe('11');expect(extractPlVersion('HH3101K810.csv')).toBe('')});it('PL Ver.は2桁まで。3桁以上は取得しない',()=>{expect(isValidPlVersion('1')).toBe(true);expect(isValidPlVersion('11')).toBe(true);expect(isValidPlVersion('v11')).toBe(true);expect(isValidPlVersion('')).toBe(false);expect(isValidPlVersion(' ')).toBe(false);expect(isValidPlVersion('260')).toBe(false);expect(isValidPlVersion('26090817')).toBe(false);/* ダウンロード日時が付いたファイル名は、Ver.を空にして入力してもらう。 */expect(extractPlVersion('HJ09301010_26090817.csv')).toBe('');expect(parsePartsList(sample,'HH110A0010_26090817.csv').plVersion).toBe('')});it('uses balloon, version, and name in identity',()=>{const p=parsePartsList(sample,'a.csv').parts[0];expect(partKey(p)).not.toBe(partKey({...p,balloon:'2'}));expect(partKey(p)).not.toBe(partKey({...p,version:'3'}))});it('40レベル（9桁目が4）は機種・ユニットに属さず、Ver.はPLと同じように扱う',()=>{/* PL名称に機種・ユニット名があっても、40レベルは機種もユニットも持たない。 */const p=parsePartsList(sample.replace('PLNO,HH110A0010','PLNO,HJ1BL04340'),'HJ1BL04340_2.csv');expect(p.plNo).toBe('HJ1BL04340');expect(p.machineId).toBe('');expect(p.modeId).toBe('');expect(p.plVersion).toBe('2');expect(plLabel(p)).toBe('HJ1BL04340 v02');/* Ver.が同じものは登録済み、Ver.が違うものは別の登録として扱う。 */expect(findRegisteredPlIds([p],[{...p,id:'same'},{...p,id:'other-version',plVersion:'3'}])).toEqual(new Set(['same']));/* 機種が違っても、同じ番号・同じVer.なら同じ40レベル部品として扱う。 */expect(plIdentityKey({...p,machineId:'HU300'})).toBe(plIdentityKey({...p,machineId:'SRC350'}));expect(findDuplicatePls([p],[{...p,id:'other-machine',machineId:'HU300'}]).get('other-machine')).toContain('登録済み')});it('Excelの範囲が実際のセルより狭いときは数え直す',()=>{/* 社内システムのExcelは A1:U41 と書かれていても、232行目までセルを持っていることがある。
  そのまま読むと41行目以降の明細が丸ごと欠けるため、実際のセルから範囲を数え直す。 */
  expect(widenedSheetRange({'!ref':'A1:U41',A1:{v:'機構別部品明細表'},B41:{v:'y'},U232:{v:'x'}})).toBe('A1:U232');
  /* 列が足りないときも広げる。 */
  expect(widenedSheetRange({'!ref':'A1:B2',A1:{v:'a'},AA3:{v:'b'}})).toBe('A1:AA3');
  /* 足りている範囲は広げない（そのまま読む）。 */
  expect(widenedSheetRange({'!ref':'A1:U232',A1:{v:'a'},U232:{v:'x'}})).toBe('');
  /* セルがないシートは何もしない。 */
  expect(widenedSheetRange({'!ref':'A1:B2'})).toBe('')});it('rejects bad files',()=>expect(()=>parsePartsList('a,b','x.csv')).toThrow('ヘッダー'))});
