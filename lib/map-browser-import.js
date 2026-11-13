// Read MAP APKG entirely in the teacher's browser. Upload happens only after review.
import {unzipSync} from '../vendor/fflate.mjs';
import {prepareMapPackage} from './map-package.js';
let sqlPromise;
async function loadSQL(){
  if(!sqlPromise)sqlPromise=(async()=>{
    if(!globalThis.initSqlJs)await new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src=new URL('../vendor/sql-wasm.js',import.meta.url).href;
      script.onload=resolve;script.onerror=()=>{script.remove();reject(new Error('APKG 读取组件加载失败，请刷新重试'));};document.head.append(script);
    });
    return globalThis.initSqlJs({locateFile:(file)=>new URL('../vendor/'+file,import.meta.url).href});
  })().catch((error)=>{sqlPromise=null;throw error;});
  return sqlPromise;
}
const digest=async(data,algorithm='sha256')=>[...new Uint8Array(await crypto.subtle.digest(algorithm==='sha1'?'SHA-1':'SHA-256',typeof data==='string'?new TextEncoder().encode(data):data))].map((b)=>b.toString(16).padStart(2,'0')).join('');
const decode=(s)=>String(s||'').replace(/&(amp|lt|gt|quot|apos|#x27|#\d+|#x[a-f\d]+);/gi,(raw,key)=>{
  const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",'#x27':"'"};if(key.toLowerCase()in named)return named[key.toLowerCase()];
  const code=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));return code>0&&code<=0x10ffff?String.fromCodePoint(code):raw;
});
const noteData=(note)=>({...Object.fromEntries(['w','pos','ipa','mean','cefr','en','cn'].map((key,i)=>[key,decode(note.fields[i])])),guid:note.guid});
export function releaseBrowserPlan(plan){for(const media of plan?.media||[])if(media.url?.startsWith('blob:'))URL.revokeObjectURL(media.url);}
export async function prepareBrowserMap(file,{SQL}={}){
  if(!file?.name?.toLowerCase().endsWith('.apkg')||!file.size||file.size>200*1024*1024)throw new Error('请选择不超过 200 MB 的 MAP APKG 文件');
  const bytes=new Uint8Array(await file.arrayBuffer());let members,size=0,count=0;const names=new Set();
  try{members=unzipSync(bytes,{filter(entry){
    if(++count>100000||names.has(entry.name)||(size+=entry.originalSize)>512*1024*1024)throw new Error('ZIP limits');
    names.add(entry.name);return !entry.name.includes('/')&&!entry.name.includes('\\');
  }});}catch{throw new Error('APKG ZIP 不完整、包含重名文件或解包规模超限');}
  if(!members['map_manifest.json'])throw new Error('请选择 MAP 特别版生成的 APKG；缺少包内 MAP 来源清单');
  if(members['map_manifest.json'].length>128*1024*1024)throw new Error('MAP 来源清单过大');
  let manifest,index;try{manifest=JSON.parse(new TextDecoder().decode(members['map_manifest.json']));index=JSON.parse(new TextDecoder().decode(members.media));}catch{throw new Error('MAP 来源清单或读音索引不完整');}
  const dbBytes=members['collection.anki2']||members['collection.anki21'];if(!dbBytes)throw new Error('APKG 缺少词库数据库');
  const sqlite=SQL||await loadSQL();let db,r;
  try{
    db=new sqlite.Database(dbBytes);
    const rows=(sql)=>{const result=db.exec(sql)[0];return result?result.values.map((row)=>Object.fromEntries(result.columns.map((col,i)=>[col,row[i]]))):[];};
    const col=rows('SELECT models FROM col')[0],models=new Map(Object.entries(JSON.parse(col.models)).map(([id,m])=>[id,{fields:m.flds.map((f)=>f.name)}]));
    r={mapManifest:manifest,models,mediaMap:new Map(),notes:rows('SELECT id,guid,mid,tags,flds FROM notes ORDER BY id').map((n)=>({id:String(n.id),guid:n.guid,mid:String(n.mid),fields:n.flds.split('\x1f'),tags:n.tags.trim().split(/\s+/).filter(Boolean)})),
      cards:rows('SELECT nid,reps,type,queue FROM cards ORDER BY id').map((c)=>({nid:String(c.nid),sched:{reps:c.reps,type:c.type,queue:c.queue}})),revlog:rows('SELECT id FROM revlog LIMIT 1')};
    for(const [member,name]of Object.entries(index))if(members[member])r.mediaMap.set(name,member);
  }catch{throw new Error('MAP APKG 数据库或 13 字段结构不完整');}finally{db?.close();}
  const output=new Map();let plan;
  try{
    plan=await prepareMapPackage({r,filename:file.name,readMedia:(member)=>members[member],storeMedia:(name,data)=>output.set(name,data),readNote:noteData,packageFingerprint:await digest(bytes),hash:digest});
    plan.media=plan.media.map((name)=>({name,size:output.get(name).length,url:URL.createObjectURL(new Blob([output.get(name)],{type:'audio/mpeg'}))}));
    return plan;
  }catch(error){releaseBrowserPlan(plan);throw error;}
}
