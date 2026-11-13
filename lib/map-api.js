import { SUPABASE_URL, ANON_KEY } from './config.js';
export const MAP_SCHEMA = 'echoo.map.vocab.v1';
async function call(token, path, method='GET', body) {
  const response=await fetch(SUPABASE_URL+path,{method,headers:{apikey:ANON_KEY,Authorization:'Bearer '+(token||ANON_KEY),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const value=await response.json();
  if (!response.ok) { const e=new Error(value.message||value.error_description||`请求失败 HTTP ${response.status}`); e.status=response.status;e.code=value.code;throw e; }
  return value;
}
const rpc=(token,name,body)=>call(token,'/rest/v1/rpc/'+name,'POST',body);
export async function mapCapability(token) {
  let result;
  try { result=await rpc(token,'anki_test_map_capabilities',{}); }
  catch(e) { if (e.status===404 || e.code==='PGRST202') throw new Error('请老师先在原 Supabase 项目运行 12 号 MAP 接入 SQL；未上传任何词库或读音'); throw e; }
  if (result?.schema!==MAP_SCHEMA || !result.assignment_snapshot) throw new Error('云端 MAP 协议版本不匹配');
  return result;
}
export async function mapPreview(token,api,plan,targetId,targetSectionId) {
  await mapCapability(token);
  if (targetId && targetId!==plan.paper.paper_id) throw new Error('MAP 的书册身份来自包内清单，不能手动并入其他材料');
  if (targetSectionId && !plan.paper.sections.some((s)=>s.id===targetSectionId)) throw new Error('MAP 来源页码不能手动改写');
  const old=await api.getBankCards([plan.paper.paper_id]), byKey=new Map(old.map((c)=>[c.card_key,c]));
  const changes={added:0,changed:0,same:0};
  for (const c of plan.cards) { const prev=byKey.get(c.card_key); changes[!prev?'added':JSON.stringify(prev.data)===JSON.stringify(c.data)?'same':'changed']++; }
  return {map:true,plan,paper:plan.paper,rows:plan.cards,changes};
}
export async function mapImport(token,preview,media,onProgress=()=>{}) {
  await mapCapability(token); // Before the first media write.
  for (let i=0;i<media.length;i++) {
    const m=media[i],url=SUPABASE_URL+'/storage/v1/object/anki-test-media/yuedu/'+encodeURIComponent(m.name);
    onProgress(`核对 MAP 读音 ${i+1}/${media.length}`);
    const headers={apikey:ANON_KEY,Authorization:'Bearer '+token};
    const existing=await fetch(url,{method:'HEAD',headers});
    if (existing.ok && Number(existing.headers.get('Content-Length'))===m.blob.size) continue;
    const response=await fetch(url,{method:'POST',headers:{...headers,'Content-Type':'audio/mpeg','x-upsert':'true'},body:m.blob});
    if (!response.ok) throw new Error(`读音上传失败（${response.status}），可重试原包`);
  }
  onProgress('在一个事务内保存 MAP 词条和 Quiz 出处…');
  const p=preview.plan,result=await rpc(token,'anki_test_map_import',{p_paper:p.paper,p_cards:p.cards,p_sources:p.relationships,p_fingerprint:p.fingerprint});
  if (!result?.complete) throw new Error('云端尚未确认 MAP 导入完成');
  return result;
}
export async function getTeachingState(code) {
  try { return await rpc(null,'anki_test_map_get_state',{p_code:code}); }
  catch(e) { if (e.status!==404 && e.code!=='PGRST202') throw e; return rpc(null,'anki_test_yuedu_get_state',{p_code:code}); }
}
