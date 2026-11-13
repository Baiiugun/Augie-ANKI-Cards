import test from 'node:test';
import assert from 'node:assert/strict';
import {checkTags} from '../../lib/library-rules.js';
import {MAP_SCHEMA,mapCapability,mapPreview,mapImport,getTeachingState} from '../../lib/map-api.js';
import {sourceSelection,visibleStudentCards} from '../../map/map-cloud.js';
const meta={material:'MAP-Reading-G06',locator:'P002',use:'阅读词',tier:'A2',courses:['MAP 阅读和语言运用']};
const tags=['课程::MAP','用途::阅读词','材料::MAP-Reading-G06-P002','MAP协议::v1','MAP科目::Reading-InformationalText','材料年级::G06','原书层级::Basic','档位::A2'];
const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const capability={schema:MAP_SCHEMA,assignment_snapshot:true};
test('MAP exact eight tags need no chapter repair and retain the complete original set',()=>{
  const result=checkTags(tags,meta,false);assert.deepEqual(result.errors,[]);assert.deepEqual(result.tags,tags);
  for(const bad of [tags.slice(1),[...tags,'篇章::P002'],tags.map((t)=>t.startsWith('材料::')?'材料::MAP-Reading-G06-P008':t),tags.map((t)=>t.startsWith('材料年级::')?'材料年级::G07':t),tags.map((t)=>t.startsWith('MAP科目::')?'MAP科目::LanguageUse-InformationalText':t)]) assert.ok(checkTags(bad,meta,true).errors.length);
});
test('MAP missing database capability stops before all media and content writes',async(t)=>{
  const calls=[];t.mock.method(globalThis,'fetch',async(url,opts)=>{calls.push([String(url),opts]);return reply({code:'PGRST202',message:'function missing'},404);});
  await assert.rejects(()=>mapImport('fixture-teacher',{plan:{}},[{name:'fixture.mp3',blob:new Blob(['fixture'])}]),/12 号/);
  assert.equal(calls.length,1);assert.match(calls[0][0],/map_capabilities$/);
});
test('MAP preview retains canonical IDs and makes no writes or legacy chapter remapping',async(t)=>{
  const calls=[];t.mock.method(globalThis,'fetch',async(url,opts)=>{calls.push(String(url));return reply(capability);});
  const plan={paper:{paper_id:'test-book',sections:[{id:'P002'}]},cards:[{card_key:'one',data:{guid:'stable',tags}}],relationships:[{card_key:'one',section_id:'P002'}]};
  const api={getBankCards:async(ids)=>{assert.deepEqual(ids,['test-book']);return [{card_key:'one',data:plan.cards[0].data}];}};
  const preview=await mapPreview('fixture-teacher',api,plan);assert.equal(preview.map,true);assert.equal(preview.rows[0].card_key,'one');assert.equal(preview.changes.same,1);
  await assert.rejects(()=>mapPreview('fixture-teacher',api,plan,'other-book'),/不能手动/);
  await assert.rejects(()=>mapPreview('fixture-teacher',api,plan,'test-book','P999'),/不能手动/);
  assert.ok(calls.every((url)=>url.endsWith('map_capabilities')));
});
test('MAP import checks capability first, reuses audio and saves card/source links in one RPC',async(t)=>{
  const calls=[],p={paper:{paper_id:'fixture'},cards:[{card_key:'stable'}],relationships:[{section_id:'P002',card_key:'stable'}],fingerprint:'same'};
  t.mock.method(globalThis,'fetch',async(url,opts)=>{
    calls.push({url:String(url),...opts});
    if(String(url).endsWith('map_capabilities'))return reply(capability);
    if(opts.method==='HEAD')return new Response(null,{status:200,headers:{'Content-Length':'7'}});
    assert.match(String(url),/map_import$/);assert.deepEqual(JSON.parse(opts.body),{p_paper:p.paper,p_cards:p.cards,p_sources:p.relationships,p_fingerprint:'same'});return reply({complete:true});
  });
  await mapImport('fixture-teacher',{plan:p},[{name:'fixture.mp3',blob:new Blob(['fixture'])}]);
  assert.deepEqual(calls.map((c)=>c.method),['POST','HEAD','POST']);assert.ok(calls.every((c)=>!c.url.includes('card_state')));
});
test('Unified student state uses MAP-aware read and falls back only when extension is absent',async(t)=>{
  let n=0;t.mock.method(globalThis,'fetch',async(url)=>{n++;return String(url).includes('map_get_state')?reply({code:'PGRST202'},404):reply({cards:[],learner:{name:'Fictitious'}});});
  assert.deepEqual((await getTeachingState('DEMO000000000001')).cards,[]);assert.equal(n,2);
  t.mock.method(globalThis,'fetch',async()=>reply({message:'expired learner'},403));
  await assert.rejects(()=>getTeachingState('DEMO000000000001'),/expired learner/);
});
test('Shared word belongs to each active Quiz without appearing twice in a multi-Quiz study queue',()=>{
  const card={card_key:'one',data:{w:'bank',mean:'银行',tiers:['B1+'],cefr:'B1'}};
  const relationships=[{card_key:'one',section_id:'P002'},{card_key:'one',section_id:'P008'}];
  const rows=sourceSelection([card],relationships,['P002','P008'],{tiers:['B1+']});assert.equal(rows.length,1);assert.deepEqual(rows[0].sections,['P002','P008']);
  const studentCard={paper:'book',sec:'P002',d:{source_sections:['P002','P008']}};
  assert.equal(visibleStudentCards([studentCard],new Set(['book|P008'])).length,1);
  assert.equal(visibleStudentCards([studentCard],new Set(['book|P099'])).length,0);
});
