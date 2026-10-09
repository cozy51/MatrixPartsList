import type { AppData } from './types';
import type { DrawingData } from './drawings';
const scope='https://www.googleapis.com/auth/drive.file';
/** アプリ外で作られたファイル（手動アップロードした画像など）を上書きするときだけ、追加で求める権限。 */
export const DRIVE_FULL_SCOPE='https://www.googleapis.com/auth/drive'; type TokenClient={requestAccessToken:(o?:{prompt?:string})=>void};
type TokenClientConfig={client_id:string;scope:string;include_granted_scopes?:boolean;callback:(r:{access_token?:string;error?:string})=>void;error_callback?:(e:{type?:string;message?:string})=>void};
declare global{interface Window{google?:{accounts:{oauth2:{initTokenClient:(o:TokenClientConfig)=>TokenClient}}}}}
let token='';const api=(url:string,init:RequestInit={})=>fetch(url,{...init,headers:{Authorization:`Bearer ${token}`,...init.headers}});
export const DRIVE_ROOT_FOLDER='WebAppsData';
export const DRIVE_ROOT_FOLDER_ID='1SWmOnYn98EN5nZs7Jsi3vBLkuJa4B_O6';
const LEGACY_DRIVE_ROOT_FOLDER='WebAppData';
/** 部品表と図面リンクは同じフォルダー内の別ファイルとして保存する。 */
export const DATA_FILE='MatrixPartsList-latest.json';
export const DRAWINGS_FILE='MatrixPartsList-drawings.json';
/** Google Identity Servicesはasyncで読み込むため、起動直後は未読込のことがある。 */
function waitForGoogle(timeoutMs=8000):Promise<NonNullable<Window['google']>>{return new Promise((resolve,reject)=>{const limit=Date.now()+timeoutMs;const check=()=>{if(window.google)return resolve(window.google);if(Date.now()>limit)return reject(new Error('Google Identity Servicesを読み込めません。'));window.setTimeout(check,100)};check()})}

/**
 * Driveへログインする。`silent` のときは同意画面もアカウント選択も出さず、
 * すでに許可済みの場合だけ黙ってトークンを取り直す（起動時の自動ログイン）。
 * 許可がなければ失敗するので、呼ぶ側は何も知らせずに手動ログインを待つ。
 * `scope` を渡すと、その権限で求め直す（`drive` は `drive.file` を含むので、そのまま使える）。
 * 同じClient IDを使う別アプリで許可したYouTubeなどの権限は、Driveの権限と一緒に求められず
 * 「アクセスをブロック: 認証エラーです（400 invalid_request）」になるため、許可済みの権限は引き継がない。
 */
export async function signIn(options:{silent?:boolean;scope?:string}={}):Promise<void>{const id=import.meta.env.VITE_GOOGLE_CLIENT_ID;if(!id)throw new Error('Google Client IDが未設定です。');const google=await waitForGoogle();return new Promise((resolve,reject)=>{
  /* 黙ってのログインは、応答がないまま終わることがある。待ち続けないよう時間で打ち切る。 */
  const timer=options.silent?window.setTimeout(()=>reject(new Error('自動ログインできませんでした。')),10000):0;
  const done=(run:()=>void)=>{if(timer)window.clearTimeout(timer);run()};
  google.accounts.oauth2.initTokenClient({client_id:id,scope:options.scope||scope,include_granted_scopes:false,
    callback:r=>done(()=>{if(r.access_token){token=r.access_token;resolve()}else reject(new Error(r.error||'ログインに失敗しました。'))}),
    error_callback:e=>done(()=>reject(new Error(e?.type||'ログインできませんでした。'))),
  }).requestAccessToken({prompt:options.silent?'none':''});});}
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
/** ログイン済み（トークン取得済み）かどうか。未ログインなら呼ぶ側でログインしてから使う。 */
export const isSignedIn=()=>!!token;
/** Driveの応答から失敗理由を取り出し、原因を追えるようにメッセージへ添える。 */
async function driveError(r:Response,message:string):Promise<Error>{let detail='';try{detail=((await r.json()) as {error?:{message?:string}}).error?.message||''}catch{/* 本文がJSONでないときは状態コードだけ出す。 */}return Object.assign(Error(r.status===401?'Googleのログインが切れました。ログインし直してください。':`${message}（${r.status}${detail?`: ${detail}`:''}）`),{status:r.status});}
/**
 * 画像を指定フォルダーへ `fileName` で保存し、ファイルIDと上書きしたかどうかを返す。
 * 同名ファイルがあれば中身だけ上書きし、IDとリンクを変えない。上書きは中身だけを送る（uploadType=media）。
 * 権限が `drive.file` のため、見つけられるのはこのアプリで保存したファイルだけ。
 */
export async function uploadImageFile(folderId:string,fileName:string,image:Blob):Promise<{id:string;replaced:boolean}>{const q=[`name='${fileName.replace(/\\/g,'\\\\').replace(/'/g,"\\'")}'`,`'${folderId}' in parents`,'trashed=false'].join(' and ');const found=await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`);if(!found.ok)throw await driveError(found,'Driveの検索に失敗しました。');const id=((await found.json()).files?.[0] as {id:string}|undefined)?.id,type=image.type||'image/png';
  if(id){const r=await api(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media&fields=id`,{method:'PATCH',headers:{'Content-Type':type},body:image});/* 403はアプリ外で作られたファイルへの書き込み権限がないとき。呼ぶ側で権限を追加してやり直せるよう印を付ける。 */if(r.status===403)throw Object.assign(Error(`${fileName} はDriveで直接アップロードされたファイルのため、上書きにはDriveへの書き込みの許可が必要です。`),{status:403,needsWriteAccess:true});if(!r.ok)throw await driveError(r,'Driveの画像の上書きに失敗しました。');return{id,replaced:true}}
  const bd='matrixImageBoundary',head=`--${bd}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({name:fileName,mimeType:type,parents:[folderId]})}\r\n--${bd}\r\nContent-Type: ${type}\r\n\r\n`,body=new Blob([head,image,`\r\n--${bd}--`]);const r=await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',{method:'POST',headers:{'Content-Type':`multipart/related; boundary=${bd}`},body});if(!r.ok)throw await driveError(r,'Driveへの画像の保存に失敗しました。フォルダーへの書き込み権限を確認してください。');const saved=await r.json() as {id?:string};if(!saved.id)throw Error('Driveへの画像の保存に失敗しました。');return{id:saved.id,replaced:false};}
