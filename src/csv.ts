import type { Part,PartsList } from './types';
import { inferMachine, inferPlMode } from './plModes';
export function parseCsv(text:string):string[][]{const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;}else if(c==='"')quoted=true;else if(c===','){row.push(cell.trim());cell='';}else if(c==='\n'){row.push(cell.trim());rows.push(row);row=[];cell='';}else if(c!=='\r')cell+=c;}if(cell||row.length){row.push(cell.trim());rows.push(row);}return rows;}
const aliases:Record<keyof Part,string[]>={balloon:['風船'],partNo:['品番'],version:['Ver.','Ver'],quantity:['数量'],name:['品名'],material:['材質・メーカー'],changeStatus:['改廃'],additionalInfo:['追加情報','備考'],unavailable:['使用不可'],unitMass:['単品質量（kg）','単品質量(kg)'],specification:['部品仕様']};
export function parsePartsList(text:string,fileName:string):PartsList{if(!text.trim())throw new Error('空のファイルです。');const rows=parseCsv(text);let plNo='',plName='';for(const row of rows)row.forEach((v,i)=>{if(v==='PLNO')plNo=row[i+1]||'';if(v==='PL名称')plName=row[i+1]||'';});const hi=rows.findIndex(r=>r.includes('品番')&&r.includes('品名')&&r.includes('風船'));if(hi<0)throw new Error('明細ヘッダー（風船・品番・品名）が見つかりません。');const header=rows[hi];const ix=(k:keyof Part)=>{for(const a of aliases[k]){const n=header.indexOf(a);if(n>=0)return n;}return-1;};const get=(r:string[],k:keyof Part)=>{const n=ix(k);return n<0?'':r[n]||'';};const parts:Part[]=[];for(const r of rows.slice(hi+1)){const balloon=get(r,'balloon'),name=get(r,'name'),partNo=get(r,'partNo'),changeStatus=get(r,'changeStatus');if(changeStatus.trim().toUpperCase()==='D')continue;if(!balloon&&!name&&!partNo)continue;if(!name&&!partNo)continue;parts.push({balloon,partNo:partNo||'+',version:get(r,'version')||'-',quantity:get(r,'quantity'),name,material:get(r,'material'),changeStatus,additionalInfo:get(r,'additionalInfo'),unavailable:get(r,'unavailable'),unitMass:get(r,'unitMass'),specification:get(r,'specification')});}if(!parts.length)throw new Error('有効な明細がありません。');const machineId=inferMachine(fileName,plName);return{id:crypto.randomUUID(),fileName,plNo:plNo||fileName.replace(/\.(csv|xlsx?|xlsm)$/i,''),plName,plVersion:extractPlVersion(fileName),machineId,modeId:inferPlMode(machineId,fileName,plName),parts,visible:true,importedAt:new Date().toISOString()};}

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
export const plLabel=(list:Pick<PartsList,'plNo'|'plVersion'>)=>{
  const version=normalizePlVersion(list.plVersion||'');
  return version?`${list.plNo} v${version}`:list.plNo;
};
export const plIdentityKey=(list:Pick<PartsList,'plNo'|'plVersion'> & {machineId?:string})=>
  `${list.machineId||'SRC350'}\u001f${list.plNo.trim().toUpperCase()}\u001f${normalizePlVersion(list.plVersion).toUpperCase()}`;
export const findRegisteredPlIds=(existing:PartsList[],candidates:PartsList[]):Set<string>=>{
  const existingKeys=new Set(existing.map(plIdentityKey));
  return new Set(candidates.filter(list=>list.plVersion.trim()&&existingKeys.has(plIdentityKey(list))).map(list=>list.id));
};
export function findDuplicatePls(existing:PartsList[],candidates:PartsList[]):Map<string,string>{
  const reasons=new Map<string,string>(),existingKeys=new Set(existing.map(plIdentityKey)),counts=new Map<string,number>();
  candidates.forEach(list=>{if(list.plVersion.trim()){const key=plIdentityKey(list);counts.set(key,(counts.get(key)||0)+1)}});
  candidates.forEach(list=>{if(!list.plVersion.trim())return;const key=plIdentityKey(list);if(existingKeys.has(key))reasons.set(list.id,`${plLabel(list)} はすでに登録済みです。`);else if((counts.get(key)||0)>1)reasons.set(list.id,`${plLabel(list)} が読み込みファイル内で重複しています。`)});
  return reasons;
}
export const partKey=(p:Part)=>[p.balloon,p.partNo,p.version,p.name,p.material,p.quantity].join('\u001f').toLocaleUpperCase();
