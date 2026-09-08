import type { AppData } from './types';
import type { DrawingData } from './drawings';
const scope='https://www.googleapis.com/auth/drive.file'; type TokenClient={requestAccessToken:(o?:{prompt?:string})=>void};
declare global{interface Window{google?:{accounts:{oauth2:{initTokenClient:(o:{client_id:string;scope:string;callback:(r:{access_token?:string;error?:string})=>void})=>TokenClient}}}}}
let token='';const api=(url:string,init:RequestInit={})=>fetch(url,{...init,headers:{Authorization:`Bearer ${token}`,...init.headers}});
export const DRIVE_ROOT_FOLDER='WebAppsData';
export const DRIVE_ROOT_FOLDER_ID='1SWmOnYn98EN5nZs7Jsi3vBLkuJa4B_O6';
const LEGACY_DRIVE_ROOT_FOLDER='WebAppData';
/** 部品表と図面リンクは同じフォルダー内の別ファイルとして保存する。 */
export const DATA_FILE='MatrixPartsList-latest.json';
export const DRAWINGS_FILE='MatrixPartsList-drawings.json';
export function signIn():Promise<void>{const id=import.meta.env.VITE_GOOGLE_CLIENT_ID;if(!id)throw new Error('Google Client IDが未設定です。');return new Promise((resolve,reject)=>{if(!window.google)return reject(new Error('Google Identity Servicesを読み込めません。'));window.google.accounts.oauth2.initTokenClient({client_id:id,scope,callback:r=>{if(r.access_token){token=r.access_token;resolve();}else reject(new Error(r.error||'ログインに失敗しました。'));}}).requestAccessToken({prompt:''});});}
async function find(name:string,parent?:string){const q=[`name='${name}'`,`trashed=false`,parent?`'${parent}' in parents`:null].filter(Boolean).join(' and ');const r=await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`);if(!r.ok)throw Error('Driveの検索に失敗しました。');return(await r.json()).files?.[0] as {id:string}|undefined;}
async function folder(name:string,parent?:string){const old=await find(name,parent);if(old)return old.id;const r=await api('https://www.googleapis.com/drive/v3/files',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,mimeType:'application/vnd.google-apps.folder',parents:parent?[parent]:undefined})});return(await r.json()).id;}
async function readCloudIn<T>(rootId:string,fileName:string):Promise<{id?:string,data?:T}>{const b=await find('MatrixPartsList',rootId);if(!b)return{};const f=await find(fileName,b.id);if(!f)return{};const r=await api(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`);return{id:f.id,data:await r.json()};}
async function readCloudFrom<T>(rootName:string,fileName:string):Promise<{id?:string,data?:T}>{const a=await find(rootName);if(!a)return{};return readCloudIn<T>(a.id,fileName);}
export async function readCloud():Promise<{id?:string,data?:AppData}>{const current=await readCloudIn<AppData>(DRIVE_ROOT_FOLDER_ID,DATA_FILE);if(current.data)return current;const named=await readCloudFrom<AppData>(DRIVE_ROOT_FOLDER,DATA_FILE);if(named.data)return{data:named.data};const legacy=await readCloudFrom<AppData>(LEGACY_DRIVE_ROOT_FOLDER,DATA_FILE);return legacy.data?{data:legacy.data}:{};}
/** 図面リンクは新しい機能のため、Folder ID指定のWebAppsDataと名前一致のフォルダーだけを見る。 */
export async function readCloudDrawings():Promise<{id?:string,data?:DrawingData}>{const current=await readCloudIn<DrawingData>(DRIVE_ROOT_FOLDER_ID,DRAWINGS_FILE);if(current.data)return current;const named=await readCloudFrom<DrawingData>(DRIVE_ROOT_FOLDER,DRAWINGS_FILE);return named.data?{data:named.data}:{};}
async function writeCloudFile(fileName:string,data:unknown,id?:string):Promise<string>{const b=await folder('MatrixPartsList',DRIVE_ROOT_FOLDER_ID);const meta={name:fileName,mimeType:'application/json',parents:id?undefined:[b]},bd='matrixBoundary',body=`--${bd}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n--${bd}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}\r\n--${bd}--`;const r=await api(id?`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=multipart`:'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',{method:id?'PATCH':'POST',headers:{'Content-Type':`multipart/related; boundary=${bd}`},body});if(!r.ok)throw Error('Driveへの保存に失敗しました。');const saved=await r.json() as {id?:string};return saved.id||id||'';}
export const writeCloud=(data:AppData,id?:string)=>writeCloudFile(DATA_FILE,data,id);
export const writeCloudDrawings=(data:DrawingData,id?:string)=>writeCloudFile(DRAWINGS_FILE,data,id);
