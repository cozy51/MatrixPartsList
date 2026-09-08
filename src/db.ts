import type { AppData } from './types';
import type { DrawingData } from './drawings';
const DB='matrix-parts-list',STORE='state',KEY='latest',DRAWING_KEY='drawings';
const open=()=>new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
async function load<T>(key:string):Promise<T|undefined>{const db=await open();return new Promise((resolve,reject)=>{const r=db.transaction(STORE).objectStore(STORE).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function save(key:string,value:unknown){const db=await open();return new Promise<void>((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(value,key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
export const loadLocal=()=>load<AppData>(KEY);
export const saveLocal=(data:AppData)=>save(KEY,data);
/** 図面リンクは部品表と別レコードで保存し、Drive上も別ファイルへ同期する。 */
export const loadLocalDrawings=()=>load<DrawingData>(DRAWING_KEY);
export const saveLocalDrawings=(data:DrawingData)=>save(DRAWING_KEY,data);
