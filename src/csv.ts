import type { Part,PartsList } from './types';
import { inferMachine, inferPlMode } from './plModes';
import { isLevel40No } from './levels';
/**
 * CSVを行・セルに分ける。引用符（`"`）はセルの先頭にあるときだけ「囲み」とみなし、
 * `1/2"` のようにセルの途中に出てくるものは文字として読む。社内システムのCSVには
 * 囲みのない引用符が混ざることがあり、囲みとして読むと以降の行がすべて1つのセルに
 * 飲み込まれて、明細が丸ごと欠けてしまうため。
 */
export function parseCsv(text:string):string[][]{
  const scanned=scanCsv(text,true);
  /* 囲みが閉じないまま終わったファイルは、引用符の数が合っていない。行を落とさないよう、
     引用符をすべて文字として読み直す。 */
  return scanned.unterminated?scanCsv(text,false).rows:scanned.rows;
}

function scanCsv(text:string,useQuotes:boolean):{rows:string[][];unterminated:boolean}{
  const rows:string[][]=[];let row:string[]=[],cell='',quoted=false,cellStart=true;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){
      /* 囲みの中では `""` が引用符1文字。単独の `"` で囲みが終わる。 */
      if(c!=='"')cell+=c;
      else if(text[i+1]==='"'){cell+='"';i++}
      else quoted=false;
      continue;
    }
    if(c==='"'&&useQuotes&&cellStart){quoted=true;cellStart=false;continue}
    if(c===','){row.push(cell.trim());cell='';cellStart=true;continue}
    if(c==='\n'){row.push(cell.trim());rows.push(row);row=[];cell='';cellStart=true;continue}
    if(c!=='\r'){cell+=c;cellStart=false}
  }
  if(cell||row.length){row.push(cell.trim());rows.push(row)}
  return {rows,unterminated:quoted};
}
const aliases:Record<keyof Part,string[]>={balloon:['風船'],partNo:['品番'],version:['Ver.','Ver'],quantity:['数量'],name:['品名'],material:['材質・メーカー'],changeStatus:['改廃'],additionalInfo:['追加情報','備考'],unavailable:['使用不可'],unitMass:['単品質量（kg）','単品質量(kg)'],specification:['部品仕様']};
export function parsePartsList(text:string,fileName:string):PartsList{if(!text.trim())throw new Error('空のファイルです。');const rows=parseCsv(text);let plNo='',plName='';for(const row of rows)row.forEach((v,i)=>{if(v==='PLNO')plNo=row[i+1]||'';if(v==='PL名称')plName=row[i+1]||'';});const hi=rows.findIndex(r=>r.includes('品番')&&r.includes('品名')&&r.includes('風船'));if(hi<0)throw new Error('明細ヘッダー（風船・品番・品名）が見つかりません。');const header=rows[hi];const ix=(k:keyof Part)=>{for(const a of aliases[k]){const n=header.indexOf(a);if(n>=0)return n;}return-1;};const get=(r:string[],k:keyof Part)=>{const n=ix(k);return n<0?'':r[n]||'';};const parts:Part[]=[];for(const r of rows.slice(hi+1)){const balloon=get(r,'balloon'),name=get(r,'name'),partNo=get(r,'partNo'),changeStatus=get(r,'changeStatus');if(changeStatus.trim().toUpperCase()==='D')continue;if(!balloon&&!name&&!partNo)continue;if(!name&&!partNo)continue;parts.push({balloon,partNo:partNo||'+',version:get(r,'version')||'-',quantity:get(r,'quantity'),name,material:get(r,'material'),changeStatus,additionalInfo:get(r,'additionalInfo'),unavailable:get(r,'unavailable'),unitMass:get(r,'unitMass'),specification:get(r,'specification')});}if(!parts.length)throw new Error('有効な明細がありません。');/* 40レベル（9桁目が4）は機種にもユニットにも属さないため、どちらも空のままにする。 */const machineId=inferMachine(fileName,plName);/* PLNOがないファイルは、ファイル名を番号として扱う。40レベルの判定にも同じ番号を使う。
   40レベル（9桁目が4）はどのユニットにも属さないため、ユニットは空のままにする。 */const listNo=plNo||fileName.replace(/\.(csv|xlsx?|xlsm)$/i,'');return{id:crypto.randomUUID(),fileName,plNo:listNo,plName,plVersion:extractPlVersion(fileName),machineId:isLevel40No(listNo)?'':machineId,modeId:isLevel40No(listNo)?'':inferPlMode(machineId,fileName,plName),parts,visible:true,importedAt:new Date().toISOString()};}

/** Excelのセル番地（`A1` 形式）。 */
const CELL_ADDRESS=/^([A-Z]+)([1-9]\d*)$/;
const columnIndex=(letters:string)=>[...letters].reduce((total,letter)=>total*26+(letter.charCodeAt(0)-64),0);
const columnName=(index:number)=>{let name='',rest=index;while(rest>0){name=String.fromCharCode(65+(rest-1)%26)+name;rest=Math.floor((rest-1)/26)}return name};

/**
 * Excelのシートに書かれた範囲（`!ref`）が、実際に値のあるセルより狭いことがある。
 * 社内システムが出力したExcelは `A1:U41` と書かれていても232行目までセルを持っており、
 * そのまま読むと明細が途中から丸ごと欠ける。実際のセルから数え直した範囲を返す。
 * 広げる必要がないときは空文字を返す。
 */
export function widenedSheetRange(sheet:Record<string,unknown>):string{
  let maxRow=0,maxColumn=0;
  for(const address of Object.keys(sheet)){
    const found=CELL_ADDRESS.exec(address);
    if(!found)continue;
    maxRow=Math.max(maxRow,Number(found[2]));
    maxColumn=Math.max(maxColumn,columnIndex(found[1]));
  }
  if(!maxRow||!maxColumn)return '';
  const end=CELL_ADDRESS.exec(String(sheet['!ref']??'').split(':')[1]??'');
  /* 書かれた範囲が実際のセルをすべて含んでいれば、そのまま読む。 */
  if(end&&Number(end[2])>=maxRow&&columnIndex(end[1])>=maxColumn)return '';
  return `A1:${columnName(maxColumn)}${maxRow}`;
}

/** Remove deleted rows from persisted or restored data created by any app version. */
export const removeDeletedParts=(lists:PartsList[]):PartsList[]=>lists.map(list=>({...list,parts:list.parts.filter(part=>(part.changeStatus||'').trim().toUpperCase()!=='D')}));

/** PL Ver.は1〜2桁。3桁以上はダウンロード日時などの誤取得とみなして無効にする。 */
export const isValidPlVersion=(value:string)=>{
  const version=value.trim().replace(/^v/i,'');
  return version.length>0&&version.length<=2;
};

export function extractPlVersion(fileName:string):string {
  const version=fileName.match(/_([^_]+)\.(?:csv|xlsx?|xlsm)$/i)?.[1]?.trim() ?? '';
  // 3桁以上はVer.ではないため取得せず、プレビューで入力してもらう。
  return isValidPlVersion(version)?version:'';
}

export const normalizePlVersion=(value:string)=>{
  const version=value.trim().replace(/^v/i,'');
  return /^\d$/.test(version)?version.padStart(2,'0'):version;
};
/**
 * 明細のVer.と、登録したリストのVer.を突き合わせるためのキー。
 * 明細のVer.なしは `-`、リストのVer.なしは空欄で表されるため、同じものとして扱う。
 * 40レベルはVer.ごとに中身が違うため、この一致でだけ結び付ける。
 */
export const versionMatchKey=(value:string)=>{const version=(value??'').trim();return version==='-'?'':normalizePlVersion(version)};
export const plLabel=(list:Pick<PartsList,'plNo'|'plVersion'>)=>{
  const version=normalizePlVersion(list.plVersion||'');
  return version?`${list.plNo} v${version}`:list.plNo;
};
/* 40レベルは機種に属さないため、同じ番号・同じVer.なら機種に関わらず同じものとして扱う。 */
export const plIdentityKey=(list:Pick<PartsList,'plNo'|'plVersion'> & {machineId?:string})=>
  `${isLevel40No(list.plNo)?'LEVEL40':list.machineId||'SRC350'}\u001f${list.plNo.trim().toUpperCase()}\u001f${normalizePlVersion(list.plVersion).toUpperCase()}`;
export const findRegisteredPlIds=(existing:PartsList[],candidates:PartsList[]):Set<string>=>{
  const existingKeys=new Set(existing.map(plIdentityKey));
  return new Set(candidates.filter(list=>list.plVersion.trim()&&existingKeys.has(plIdentityKey(list))).map(list=>list.id));
};
export function findDuplicatePls(existing:PartsList[],candidates:PartsList[]):Map<string,string>{
  const reasons=new Map<string,string>(),existingKeys=new Set(existing.map(plIdentityKey)),counts=new Map<string,number>();
  candidates.forEach(list=>{if(list.plVersion.trim()){const key=plIdentityKey(list);counts.set(key,(counts.get(key)||0)+1)}});
  candidates.forEach(list=>{if(!list.plVersion.trim())return;const key=plIdentityKey(list);if(existingKeys.has(key))reasons.set(list.id,`${plLabel(list)} はすでに登録済みです。上書きはできないため、入れ替えるときは登録済みのPLを削除してから読み込み直してください。`);else if((counts.get(key)||0)>1)reasons.set(list.id,`${plLabel(list)} が読み込みファイル内で重複しています。`)});
  return reasons;
}
export const partKey=(p:Part)=>[p.balloon,p.partNo,p.version,p.name,p.material,p.quantity].join('\u001f').toLocaleUpperCase();
