// Shared MAP package validator: used by Node and the online browser importer.
import { parseFilename, checkTags } from './library-rules.js';
const byteLength=(text)=>new TextEncoder().encode(text).length;
const SCHEMA = 'echoo.map.vocab.v1';
const FIELDS = ['Word','POS','IPA','Meaning','CEFR','Example','ExampleCN','Audio','Source','MAPSchema','MAPWordID','MAPSources','MAPBook'];
const fail = (message) => { throw new Error('MAP 校验未通过：' + message); };
const equalSet = (a,b) => a.length === b.length && new Set(a).size === a.length && a.every((x) => b.includes(x));
const unique = (values, fallback) => { const v=[...new Set(values.filter((x)=>x!==undefined && x!==null && x!==''))]; return v.length===1?v[0]:fallback; };
const tight = (s) => String(s).replace(/\s+/g,'');
function expectedTags(book, exercises, locator, tier) {
  return ['课程::MAP','用途::阅读词',`材料::${book.slug}-${locator}`,'MAP协议::v1',
    `MAP科目::${tight(book.subject)}-${unique(exercises.map((e)=>tight(e.domain||'Comprehensive')),'综合')}`,
    `材料年级::${unique(exercises.filter((e)=>e.grade!=null).map((e)=>'G'+String(e.grade).padStart(2,'0')),book.volume||'未标注')}`,
    `原书层级::${unique(exercises.map((e)=>e.difficulty||'未标注'),'综合')}`,`档位::${tier||'全量'}`];
}
export async function prepareMapPackage({r,filename,readMedia,storeMedia,readNote,packageFingerprint,hash}) {
  const manifest=r.mapManifest, meta=parseFilename(filename);
  if (!manifest || manifest.schema!==SCHEMA || manifest.scope!=='book_snapshot') fail('缺少有效的 map_manifest.json，不能按普通篇章导入以免产生重复进度');
  if (![undefined,'map-compact-v1'].includes(manifest.tag_profile)) fail('不支持的标签规范版本');
  const {book, exercises, words}=manifest;
  if (!book?.id || !book.slug || !book.edition || !Array.isArray(exercises) || !exercises.length || !Array.isArray(words) || !words.length) fail('书册身份、练习或词条清单不完整');
  const locator=manifest.export_unit==='quiz'?manifest.export_locator:'BOOK';
  if (book.slug!==meta.material || manifest.batch!==meta.batch || manifest.revision!==meta.version || locator!==meta.locator || (manifest.tier||'')!==meta.tier) fail('文件名与来源清单的书册、页码、批次、版本或档位不一致');
  if (manifest.export_unit==='quiz' && (exercises.length!==1 || exercises[0].locator!==locator || !/^P\d{3,}$/.test(locator))) fail('一个 Quiz 文件必须对应一份完整练习');
  if (r.revlog.length || r.cards.some((c)=>c.sched.reps || c.sched.type || c.sched.queue>0)) fail('不能上传个人学习进度');
  if (!r.notes.length || r.notes.length!==r.cards.length || words.length!==r.notes.length ||
      new Set(words.map((w)=>w.guid)).size!==words.length || new Set(words.map((w)=>w.id)).size!==words.length ||
      new Set(r.cards.map((c)=>c.nid)).size!==r.notes.length) fail('词条、GUID 或卡片数量不一致');
  for (const model of r.models.values()) if (JSON.stringify(model.fields)!==JSON.stringify(FIELDS)) fail('MAP 的 13 个字段结构不匹配');
  const byGuid=new Map(words.map((w)=>[w.guid,w])), byId=new Map(words.map((w)=>[w.id,w]));
  const exById=new Map(exercises.map((e)=>[e.locator,e]));
  if (exById.size!==exercises.length) fail('重复的练习编号');
  for (const e of exercises) {
    if (!/^P\d{3,}[A-Z]?$/.test(e.locator) || Number(e.locator.match(/\d+/)[0])!==e.pdf_start_page || !Array.isArray(e.word_ids) || new Set(e.word_ids).size!==e.word_ids.length) fail('练习编号必须使用原始 PDF 页码');
    for (const id of e.word_ids) if (!byId.get(id)?.sources?.includes(e.locator)) fail('练习与词条的双向引用不一致');
  }
  const paperId='teach:'+(await hash(book.slug.normalize('NFKC').toLowerCase().replace(/[\s_-]+/g,'')+'|'+book.edition+'|阅读词','sha1')).slice(0,24);
  const keys=new Map(), cards=[], media=new Set();
  for (const note of r.notes) {
    const word=byGuid.get(note.guid), f=note.fields;
    if (!word || !Array.isArray(word.sources) || (await hash(JSON.stringify(f)))!==word.fields_sha256 || f[9]!==SCHEMA || f[10]!==word.id || !equalSet(JSON.parse(f[11]),word.sources)) fail('词条字段、身份或来源与清单不符');
    for (const sid of word.sources) if (!exById.get(sid)?.word_ids?.includes(word.id)) fail('词条引用了不存在的来源');
    if (manifest.tag_profile==='map-compact-v1') {
      if (!equalSet(note.tags,expectedTags(book,exercises,locator,manifest.tier))) fail('每张卡必须恰好保留约定的 8 个标签');
      if (/^MAP-(Reading|LanguageUse)-G/.test(book.slug)) {
        const checked=checkTags(note.tags,{...meta,courses:['MAP 阅读和语言运用']});
        if (checked.errors.length) fail(checked.errors.join('；'));
      }
    } else if (!['课程::MAP','用途::阅读词',`材料::${book.slug}`,`篇章::${locator}`,'MAP协议::v1'].every((tag)=>note.tags.includes(tag))) fail('缺少原版 MAP 基础标签');
    const original=word.audio, stored=r.mediaMap.get(original);
    if (!original || !stored || f[7]!==`[sound:${original}]`) fail('读音或音频引用缺失');
    const bytes=await readMedia(stored);
    if ((await hash(bytes))+'.mp3'!==original || bytes.length<128 || !((bytes[0]===73 && bytes[1]===68 && bytes[2]===51) || (bytes[0]===0xff && (bytes[1]&0xe0)===0xe0))) fail('音频内容哈希或 MP3 格式不符');
    await storeMedia(original,bytes); media.add(original);
    const {sound,...data}=readNote(note,r.models.get(note.mid));
    if (!data.w || !data.mean) fail('缺少词形或词义');
    Object.assign(data,{audio:original,tags:[...note.tags],tiers:meta.tier?[meta.tier]:[],map_schema:SCHEMA,map_word_id:word.id,source_sections:word.sources});
    if (byteLength(JSON.stringify(data))>19000) fail('词条超出现有云端内容大小限制');
    const key='yd:'+(await hash(paperId+'|map|'+note.guid,'sha1')).slice(0,24); keys.set(word.id,key);
    cards.push({card_key:key,paper_id:paperId,section_id:'BOOK',ord:cards.length,data});
  }
  const relationships=[], sections=exercises.map((e)=>{
    for (const id of e.word_ids) {
      const context=(byId.get(id).occurrences||[]).filter((o)=>o.locator===e.locator).slice(0,6).map((o)=>({
        part:o.part,question:o.question??null,material:o.material??null,occurrence_index:o.occurrence_index||1,pages:o.pages||[],quote:String(o.quote||'').slice(0,1500)}));
      if (!context.length || byteLength(JSON.stringify(context))>20000) fail('练习来源语境缺失或过长');
      relationships.push({paper_id:paperId,section_id:e.locator,card_key:keys.get(id),context});
    }
    return {id:e.locator,label:e.locator+' · '+e.display_title,board:e.domain||'',piece:e.title,sort:e.pdf_start_page,count:e.word_ids.length,level:'',tiers:meta.tier?[meta.tier]:[],map:true,
      metadata:Object.fromEntries(['grade','difficulty','kind','number','pdf_start_page','printed_start_page','aliases','processing_status'].map((k)=>[k,e[k]??null])),tags:[book.slug,e.locator]};
  });
  return {file:filename,schema:SCHEMA,fingerprint:packageFingerprint,cards,relationships,media:[...media],warnings:[],paper:{
    paper_id:paperId,bank:'阅读词',name:book.slug.replace(/-/g,' '),sort:0,sections,source:{schema:1,courses:['MAP 阅读和语言运用'],sourceType:'教材／书籍',edition:book.edition,materialSlug:book.slug,map_schema:SCHEMA,map_book_id:book.id,pdf_sha256:book.pdf_sha256,pdf_name:book.pdf_name,filename,batch:meta.batch,version:meta.version,snapshot_sha256:manifest.snapshot_sha256,partial:!!manifest.partial,tag_profile:manifest.tag_profile,tiers:meta.tier?[meta.tier]:[]}}};
}
