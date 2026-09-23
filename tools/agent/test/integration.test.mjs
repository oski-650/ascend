import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, copyFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile),root=resolve(import.meta.dirname,'../../..'),cli=join(root,'tools/agent/agent.mjs');
async function command(cwd,bin,args,env={}){try{const r=await exec(bin,args,{cwd,env:{...process.env,...env},maxBuffer:16*1024*1024});return {code:0,out:r.stdout,err:r.stderr};}catch(e){return {code:typeof e.code==='number'?e.code:1,out:e.stdout||'',err:e.stderr||e.message};}}
const g=(cwd,...args)=>command(cwd,'git',args);
async function run(cwd,agent,...args){return command(cwd,'node',[cli,...args,'--json'],{ASCEND_AGENT:agent,NODE_ENV:'test'});}
async function admin(cwd,...args){return command(cwd,'node',[cli,'admin',...args,'--human','oscar','--reason','fixture','--json'],{ASCEND_AGENT:'',ASCEND_AGENT_TEST_CONFIRM:'1',NODE_ENV:'test'});}
async function setup(gates={}){
  const dir=await mkdtemp(join(tmpdir(),'ascend-agent-test-')),bare=join(dir,'origin.git'),codex=join(dir,'codex'),claude=join(dir,'claude');
  assert.equal((await g(dir,'init','--bare',bare)).code,0);assert.equal((await g(dir,'clone',bare,codex)).code,0);
  await g(codex,'config','user.name','Fixture');await g(codex,'config','user.email','fixture@example.test');
  await g(codex,'checkout','-b','dev');await writeFile(join(codex,'a.txt'),'base\n');await writeFile(join(codex,'b.txt'),'base\n');
  await mkdir(join(codex,'tools/agent'),{recursive:true});await writeFile(join(codex,'tools/agent/gates.json'),JSON.stringify(gates)+'\n');
  await g(codex,'add','.');await g(codex,'commit','-m','baseline');assert.equal((await g(codex,'push','origin','HEAD:dev')).code,0);
  assert.equal((await g(dir,'clone','-b','dev',bare,claude)).code,0);await g(claude,'config','user.name','Fixture');await g(claude,'config','user.email','fixture@example.test');
  assert.equal((await admin(codex,'init','--baseline-ref','refs/heads/dev')).code,0);
  return {dir,bare,codex,claude};
}
function task(id='T1',path='a.txt'){return {id,title:id,kind:'implement',priority:1,builder:'codex',reviewer:'claude',write_paths:[path],read_paths:[],blocked_paths:[],prerequisites:[],required_gates:[],promotion_gates:[],required_manual_checks:[],read_first:[],promote_policy:'auto',promote_mode:'ff_only'};}
async function add(f,t){const p=join(f.dir,`${t.id}.json`);await writeFile(p,JSON.stringify(t));return admin(f.codex,'task-add',p);}
async function result(f,round,sha,tree,verdict,findings=[]){const p=join(f.dir,`result-${round}.json`);await writeFile(p,JSON.stringify({round,reviewed_sha:sha,reviewed_tree:tree,verdict,findings,prior_findings:[],manual_checks:[],evidence_reuse:[],notes:''}));return p;}
function parsed(r){try{return JSON.parse(r.out);}catch{return {raw:r.out,err:r.err};}}
test('T21 complete two-round local Git lifecycle and audit replay',async()=>{
  const f=await setup();try{
    assert.equal((await add(f,task())).code,0);
    assert.equal((await run(f.codex,'codex','claim','T1','--as','codex')).code,0);
    await writeFile(join(f.codex,'a.txt'),'round1\n');
    const freeze1=await run(f.codex,'codex','freeze','T1','--as','codex');assert.equal(freeze1.code,0,freeze1.err);const r1=parsed(freeze1);
    const start1=await run(f.claude,'claude','review-start','T1','--as','claude','--worktree',join(f.dir,'review1'));assert.equal(start1.code,0,start1.err);
    const tree1=(await g(f.codex,'rev-parse',`${r1.sha}^{tree}`)).out.trim();
    const finding={id:'T1-r1-F1',blocking:true,severity:'high',paths:['a.txt'],line:1,observed:'wrong',expected:'right',minimal_repair:'fix it',regression_proof:{kind:'manual',description:'read file'},requires_scope_change:false,suggested_patch:null};
    const fix=await run(f.claude,'claude','review-result','T1','--as','claude','--result',await result(f,1,r1.sha,tree1,'FIX_REQUIRED',[finding]));assert.equal(fix.code,0,fix.err);
    await writeFile(join(f.codex,'a.txt'),'round2\n');const freeze2=await run(f.codex,'codex','freeze','T1','--as','codex');assert.equal(freeze2.code,0,freeze2.err);const r2=parsed(freeze2);
    const start2=await run(f.claude,'claude','review-start','T1','--as','claude','--worktree',join(f.dir,'review2'));assert.equal(start2.code,0,start2.err);
    const tree2=(await g(f.codex,'rev-parse',`${r2.sha}^{tree}`)).out.trim();const acceptFile=await result(f,2,r2.sha,tree2,'ACCEPT');const accept=JSON.parse(await readFile(acceptFile,'utf8'));accept.prior_findings=[{id:finding.id,disposition:'resolved',evidence:'round 2 file'}];await writeFile(acceptFile,JSON.stringify(accept));
    const accepted=await run(f.claude,'claude','review-result','T1','--as','claude','--result',acceptFile);assert.equal(accepted.code,0,accepted.err);
    const promoted=await run(f.codex,'codex','promote','T1','--as','codex');assert.equal(promoted.code,0,promoted.err);
    const verify=await run(f.codex,'codex','verify');assert.equal(verify.code,0,verify.err);
    assert.equal((await g(f.codex,'ls-remote','origin','refs/heads/dev')).out.split('\t')[0],r2.sha);
    const tip=(await g(f.codex,'ls-remote','origin','refs/heads/agents/coord')).out.split('\t')[0];const log=(await g(f.codex,'show',`${tip}:activity.jsonl`)).out.trim().split('\n').map(JSON.parse);
    assert.deepEqual(log.map(x=>x.type),['coord.initialized','task.created','task.claimed','review.published','review.started','review.fix_required','review.published','review.started','review.accepted','task.promoted']);
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('T04 unauthorized worktree file blocks freeze before any commit or publish',async()=>{
  const f=await setup();try{assert.equal((await add(f,task())).code,0);assert.equal((await run(f.codex,'codex','claim','T1','--as','codex')).code,0);
    await writeFile(join(f.codex,'a.txt'),'allowed\n');await writeFile(join(f.codex,'rogue.txt'),'unauthorized\n');
    const head=(await g(f.codex,'rev-parse','HEAD')).out.trim(),r=await run(f.codex,'codex','freeze','T1','--as','codex');assert.equal(r.code,1,r.err);assert.match(r.err,/UNAUTHORIZED_PATHS.*rogue\.txt/);
    assert.equal((await g(f.codex,'rev-parse','HEAD')).out.trim(),head);assert.equal((await g(f.codex,'ls-remote','origin','refs/heads/review/t1-r1')).out.trim(),'');
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('T04 tracked unauthorized edit is named in refusal',async()=>{
  const f=await setup();try{await add(f,task());await run(f.codex,'codex','claim','T1','--as','codex');await writeFile(join(f.codex,'a.txt'),'allowed\n');await writeFile(join(f.codex,'b.txt'),'tracked but forbidden\n');
    const r=await run(f.codex,'codex','freeze','T1','--as','codex');assert.equal(r.code,1,r.err);assert.match(r.err,/UNAUTHORIZED_PATHS.*b\.txt/);
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('T06 moved review ref invalidates and blocks a task',async()=>{
  const f=await setup();try{assert.equal((await add(f,task())).code,0);assert.equal((await run(f.codex,'codex','claim','T1','--as','codex')).code,0);await writeFile(join(f.codex,'a.txt'),'new\n');
    const p=await run(f.codex,'codex','freeze','T1','--as','codex');assert.equal(p.code,0,p.err);
    const base=(await g(f.codex,'rev-parse','HEAD~1')).out.trim();assert.equal((await g(f.bare,'update-ref','refs/heads/review/t1-r1',base)).code,0);
    const r=await run(f.claude,'claude','review-start','T1','--as','claude','--worktree',join(f.dir,'review'));assert.equal(r.code,6,r.err);assert.match(r.err,/REVIEW_INVALIDATED/);
    const s=parsed(await run(f.codex,'codex','status','--task','T1'));assert.equal(s.tasks[0].state,'BLOCKED');
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('T10 ACCEPT binds to pushed bytes despite local edits',async()=>{
  const f=await setup();try{assert.equal((await add(f,task())).code,0);await run(f.codex,'codex','claim','T1','--as','codex');await writeFile(join(f.codex,'a.txt'),'accepted\n');
    const p=parsed(await run(f.codex,'codex','freeze','T1','--as','codex'));assert.ok(p.sha);assert.equal((await run(f.claude,'claude','review-start','T1','--as','claude','--worktree',join(f.dir,'review'))).code,0);
    const tree=(await g(f.codex,'rev-parse',`${p.sha}^{tree}`)).out.trim();assert.equal((await run(f.claude,'claude','review-result','T1','--as','claude','--result',await result(f,1,p.sha,tree,'ACCEPT'))).code,0);
    await writeFile(join(f.codex,'a.txt'),'unreviewed\n');const promoted=await run(f.codex,'codex','promote','T1','--as','codex');assert.equal(promoted.code,0,promoted.err);
    const tip=(await g(f.codex,'ls-remote','origin','refs/heads/dev')).out.split('\t')[0];assert.equal(tip,p.sha);assert.equal((await g(f.codex,'show',`${tip}:a.txt`)).out,'accepted\n');
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('T11 wrong reviewer and agent identity are refused',async()=>{
  const f=await setup();try{assert.equal((await add(f,task())).code,0);await run(f.codex,'codex','claim','T1','--as','codex');await writeFile(join(f.codex,'a.txt'),'new\n');assert.equal((await run(f.codex,'codex','freeze','T1','--as','codex')).code,0);
    assert.equal((await run(f.codex,'codex','review-start','T1','--as','codex')).code,1);
    const mismatch=await command(f.codex,'node',[cli,'review-start','T1','--as','claude','--json'],{ASCEND_AGENT:'codex',NODE_ENV:'test'});assert.equal(mismatch.code,2);
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('T14 stale-lock override is explicit, human-only, and audited',async()=>{
  const f=await setup();try{assert.equal((await add(f,task())).code,0);await run(f.codex,'codex','claim','T1','--as','codex');
    const fake=await command(f.codex,'node',[cli,'admin','release','T1','--human','oscar','--reason','fixture','--json'],{ASCEND_AGENT:'codex',ASCEND_AGENT_TEST_CONFIRM:'1',NODE_ENV:'test'});assert.equal(fake.code,2);
    assert.equal((await admin(f.codex,'release','T1')).code,0);const tip=(await g(f.codex,'ls-remote','origin','refs/heads/agents/coord')).out.split('\t')[0];const log=(await g(f.codex,'show',`${tip}:activity.jsonl`)).out.trim().split('\n').map(JSON.parse);assert.equal(log.at(-1).type,'lock.released');assert.equal(log.at(-1).override,true);
    assert.equal(parsed(await run(f.codex,'codex','status','--task','T1')).tasks[0].state,'AVAILABLE');
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('T16 branch collision fails before publishing',async()=>{
  const f=await setup();try{assert.equal((await add(f,task())).code,0);await run(f.codex,'codex','claim','T1','--as','codex');await writeFile(join(f.codex,'a.txt'),'new\n');
    const base=(await g(f.codex,'rev-parse','HEAD')).out.trim();await g(f.codex,'push','origin',`${base}:refs/heads/review/t1-r1`);
    const r=await run(f.codex,'codex','freeze','T1','--as','codex');assert.equal(r.code,1,r.err);assert.match(r.err,/BRANCH_COLLISION/);
    assert.equal(parsed(await run(f.codex,'codex','status','--task','T1')).tasks[0].state,'IMPLEMENTING');
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('T18 disjoint accepted branches promote by verified overlay',async()=>{
  const f=await setup();try{
    const second={...task('T2','b.txt'),builder:'claude',reviewer:'codex',promote_mode:'overlay_allowed'};assert.equal((await add(f,task())).code,0);assert.equal((await add(f,second)).code,0);
    assert.equal((await run(f.codex,'codex','claim','T1','--as','codex')).code,0);assert.equal((await run(f.claude,'claude','claim','T2','--as','claude')).code,0);
    await writeFile(join(f.codex,'a.txt'),'a changed\n');await writeFile(join(f.claude,'b.txt'),'b changed\n');
    const p1=parsed(await run(f.codex,'codex','freeze','T1','--as','codex')),p2=parsed(await run(f.claude,'claude','freeze','T2','--as','claude'));assert.ok(p1.sha);assert.ok(p2.sha);
    assert.equal((await run(f.claude,'claude','review-start','T1','--as','claude','--worktree',join(f.dir,'review1'))).code,0);
    assert.equal((await run(f.codex,'codex','review-start','T2','--as','codex','--worktree',join(f.dir,'review2'))).code,0);
    const tree1=(await g(f.codex,'rev-parse',`${p1.sha}^{tree}`)).out.trim(),tree2=(await g(f.claude,'rev-parse',`${p2.sha}^{tree}`)).out.trim();
    assert.equal((await run(f.claude,'claude','review-result','T1','--as','claude','--result',await result(f,1,p1.sha,tree1,'ACCEPT'))).code,0);
    const result2=await result(f,1,p2.sha,tree2,'ACCEPT');assert.equal((await run(f.codex,'codex','review-result','T2','--as','codex','--result',result2)).code,0);
    assert.equal((await run(f.codex,'codex','promote','T1','--as','codex')).code,0);
    const overlay=await run(f.claude,'claude','promote','T2','--as','claude');assert.equal(overlay.code,0,overlay.err);assert.equal(parsed(overlay).mode,'overlay');
    const tip=(await g(f.claude,'ls-remote','origin','refs/heads/dev')).out.split('\t')[0];assert.equal((await g(f.claude,'show',`${tip}:a.txt`)).out,'a changed\n');assert.equal((await g(f.claude,'show',`${tip}:b.txt`)).out,'b changed\n');
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('T01 and T03 concurrent claims serialize and disjoint claims both succeed',async()=>{
  const f=await setup();try{
    assert.equal((await add(f,task())).code,0);const same=await Promise.all([run(f.codex,'codex','claim','T1','--as','codex'),run(f.claude,'codex','claim','T1','--as','codex')]);assert.deepEqual(same.map(x=>x.code).sort(),[0,1]);
    assert.equal(parsed(await run(f.codex,'codex','status','--task','T1')).tasks[0].state,'IMPLEMENTING');
    assert.equal((await admin(f.codex,'release','T1')).code,0);
    const other={...task('T2','b.txt'),builder:'claude',reviewer:'codex'};assert.equal((await add(f,other)).code,0);
    const disjoint=await Promise.all([run(f.codex,'codex','claim','T1','--as','codex'),run(f.claude,'claude','claim','T2','--as','claude')]);assert.deepEqual(disjoint.map(x=>x.code),[0,0],disjoint.map(x=>x.err).join('\n'));
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('T08 and T09 stale results are rejected and audited after a new round',async()=>{
  const f=await setup();try{
    await add(f,task());await run(f.codex,'codex','claim','T1','--as','codex');await writeFile(join(f.codex,'a.txt'),'one\n');const p1=parsed(await run(f.codex,'codex','freeze','T1','--as','codex'));
    await run(f.claude,'claude','review-start','T1','--as','claude','--worktree',join(f.dir,'review1'));
    const tree1=(await g(f.codex,'rev-parse',`${p1.sha}^{tree}`)).out.trim();const finding={id:'F1',blocking:true,severity:'high',paths:['a.txt'],observed:'one',expected:'two',minimal_repair:'write two',regression_proof:{kind:'manual',description:'read'},requires_scope_change:false};
    await run(f.claude,'claude','review-result','T1','--as','claude','--result',await result(f,1,p1.sha,tree1,'FIX_REQUIRED',[finding]));
    await writeFile(join(f.codex,'a.txt'),'two\n');assert.equal((await run(f.codex,'codex','freeze','T1','--as','codex')).code,0);
    for(const verdict of ['FIX_REQUIRED','ACCEPT']){const stale=await run(f.claude,'claude','review-result','T1','--as','claude','--result',await result(f,1,p1.sha,tree1,verdict,verdict==='FIX_REQUIRED'?[finding]:[]));assert.equal(stale.code,6,stale.err);}
    assert.equal(parsed(await run(f.codex,'codex','status','--task','T1')).tasks[0].state,'PUBLISHED');
    const tip=(await g(f.codex,'ls-remote','origin','refs/heads/agents/coord')).out.split('\t')[0],log=(await g(f.codex,'show',`${tip}:activity.jsonl`)).out;assert.equal((log.match(/review\.stale_rejected/g)||[]).length,2);
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('T13 rejected atomic Git push leaves coordinator in IMPLEMENTING',async()=>{
  const f=await setup();try{
    await add(f,task());await run(f.codex,'codex','claim','T1','--as','codex');await writeFile(join(f.codex,'a.txt'),'new\n');
    const hook=join(f.bare,'hooks/pre-receive');await writeFile(hook,'#!/bin/sh\nexit 1\n',{mode:0o755});
    const r=await run(f.codex,'codex','freeze','T1','--as','codex');assert.equal(r.code,4,r.err);
    assert.equal(parsed(await run(f.codex,'codex','status','--task','T1')).tasks[0].state,'IMPLEMENTING');assert.equal((await g(f.codex,'ls-remote','origin','refs/heads/review/t1-r1')).out.trim(),'');
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('T20 foreign coord commit fails closed until a human attests',async()=>{
  const f=await setup();try{
    const repair=join(f.dir,'repair');assert.equal((await g(f.dir,'clone','-b','agents/coord',f.bare,repair)).code,0);await g(repair,'config','user.name','Fixture');await g(repair,'config','user.email','fixture@example.test');
    await writeFile(join(repair,'note.txt'),'external note\n');await g(repair,'add','note.txt');await g(repair,'commit','-m','foreign edit');assert.equal((await g(repair,'push','origin','HEAD:agents/coord')).code,0);
    const before=await run(f.codex,'codex','status');assert.equal(before.code,3,before.err);assert.match(before.err,/COORD_FOREIGN_COMMIT/);
    // A manual repair removes the extra path and makes the tree valid before attestation.
    await g(repair,'rm','note.txt');await g(repair,'commit','-m','remove note');await g(repair,'push','origin','HEAD:agents/coord');
    const attested=await admin(f.codex,'attest-repair');assert.equal(attested.code,0,attested.err);
    assert.equal((await run(f.codex,'codex','verify')).code,0);
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('T26 promotion recovers when accepted SHA already reached baseline',async()=>{
  const f=await setup();try{
    await add(f,task());await run(f.codex,'codex','claim','T1','--as','codex');await writeFile(join(f.codex,'a.txt'),'accepted\n');const p=parsed(await run(f.codex,'codex','freeze','T1','--as','codex'));
    await run(f.claude,'claude','review-start','T1','--as','claude','--worktree',join(f.dir,'review'));const tree=(await g(f.codex,'rev-parse',`${p.sha}^{tree}`)).out.trim();await run(f.claude,'claude','review-result','T1','--as','claude','--result',await result(f,1,p.sha,tree,'ACCEPT'));
    assert.equal((await g(f.codex,'push','origin',`${p.sha}:refs/heads/dev`)).code,0);const recovered=await run(f.codex,'codex','promote','T1','--as','codex');assert.equal(recovered.code,0,recovered.err);assert.equal(parsed(recovered).mode,'recovered');
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('T05 failing or tree-dirtying gates do not publish',async()=>{
  for(const [name,script,expected] of [['bad','process.exit(2)',7],['dirty',"require('fs').writeFileSync('a.txt','dirty')",1]]){
    const f=await setup({[name]:{cmd:['node','-e',script],cwd:'.',timeout_s:10}});try{
      assert.equal((await add(f,{...task(),required_gates:[name]})).code,0);await run(f.codex,'codex','claim','T1','--as','codex');await writeFile(join(f.codex,'a.txt'),'candidate\n');
      const r=await run(f.codex,'codex','freeze','T1','--as','codex');assert.equal(r.code,expected,r.err);assert.equal(parsed(await run(f.codex,'codex','status','--task','T1')).tasks[0].state,'IMPLEMENTING');assert.equal((await g(f.codex,'ls-remote','origin','refs/heads/review/t1-r1')).out.trim(),'');
    }finally{await rm(f.dir,{recursive:true,force:true});}
  }
});
test('T12 malformed task cache fails closed',async()=>{
  const f=await setup();try{
    await add(f,task());const repair=join(f.dir,'repair');await g(f.dir,'clone','-b','agents/coord',f.bare,repair);await g(repair,'config','user.name','Fixture');await g(repair,'config','user.email','fixture@example.test');
    const path=join(repair,'tasks/T1.json'),t=JSON.parse(await readFile(path,'utf8'));t.state='PROMOTED';await writeFile(path,JSON.stringify(t));await g(repair,'add','.');await g(repair,'commit','-m','alter task\n\nAscend-Coord-Seq: 3\nAscend-Coord-Op: manual\nAscend-Coord-Actor: human\nAscend-Coord-Task: T1');await g(repair,'push','origin','HEAD:agents/coord');
    const r=await run(f.codex,'codex','status');assert.equal(r.code,3,r.err);assert.match(r.err,/COORD_INVALID/);
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('T25 changed evidence reuse is refused',async()=>{
  const f=await setup();try{
    await add(f,task());await run(f.codex,'codex','claim','T1','--as','codex');await writeFile(join(f.codex,'a.txt'),'one\n');const p1=parsed(await run(f.codex,'codex','freeze','T1','--as','codex'));
    await run(f.claude,'claude','review-start','T1','--as','claude','--worktree',join(f.dir,'review1'));const tree1=(await g(f.codex,'rev-parse',`${p1.sha}^{tree}`)).out.trim();
    const finding={id:'F1',blocking:true,severity:'high',paths:['a.txt'],observed:'one',expected:'two',minimal_repair:'write two',regression_proof:{kind:'manual',description:'read'},requires_scope_change:false};await run(f.claude,'claude','review-result','T1','--as','claude','--result',await result(f,1,p1.sha,tree1,'FIX_REQUIRED',[finding]));
    await writeFile(join(f.codex,'a.txt'),'two\n');const p2=parsed(await run(f.codex,'codex','freeze','T1','--as','codex'));await run(f.claude,'claude','review-start','T1','--as','claude','--worktree',join(f.dir,'review2'));
    const tree2=(await g(f.codex,'rev-parse',`${p2.sha}^{tree}`)).out.trim(),file=await result(f,2,p2.sha,tree2,'ACCEPT');const data=JSON.parse(await readFile(file,'utf8'));data.prior_findings=[{id:'F1',disposition:'resolved',evidence:'changed'}];data.evidence_reuse=[{from_round:1,item:'read file',paths:['a.txt']}];await writeFile(file,JSON.stringify(data));
    const r=await run(f.claude,'claude','review-result','T1','--as','claude','--result',file);assert.equal(r.code,1,r.err);assert.match(r.err,/EVIDENCE_CHANGED/);
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('T15 duplicate result for the same round is refused',async()=>{
  const f=await setup();try{
    await add(f,task());await run(f.codex,'codex','claim','T1','--as','codex');await writeFile(join(f.codex,'a.txt'),'candidate\n');const p=parsed(await run(f.codex,'codex','freeze','T1','--as','codex'));
    await run(f.claude,'claude','review-start','T1','--as','claude','--worktree',join(f.dir,'review'));const tree=(await g(f.codex,'rev-parse',`${p.sha}^{tree}`)).out.trim(),file=await result(f,1,p.sha,tree,'ACCEPT');
    assert.equal((await run(f.claude,'claude','review-result','T1','--as','claude','--result',file)).code,0);const again=await run(f.claude,'claude','review-result','T1','--as','claude','--result',file);assert.equal(again.code,6,again.err);
    await g(f.codex,'fetch','origin','agents/coord');const tip=(await g(f.codex,'ls-remote','origin','refs/heads/agents/coord')).out.split('\t')[0],names=(await g(f.codex,'ls-tree','-r','--name-only',tip)).out;assert.equal((names.match(/r1\.result\.json/g)||[]).length,1);
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('T17 wrong accepted SHA in coord fails closed',async()=>{
  const f=await setup();try{
    await add(f,task());await run(f.codex,'codex','claim','T1','--as','codex');await writeFile(join(f.codex,'a.txt'),'accepted\n');const p=parsed(await run(f.codex,'codex','freeze','T1','--as','codex'));
    await run(f.claude,'claude','review-start','T1','--as','claude','--worktree',join(f.dir,'review'));const tree=(await g(f.codex,'rev-parse',`${p.sha}^{tree}`)).out.trim();await run(f.claude,'claude','review-result','T1','--as','claude','--result',await result(f,1,p.sha,tree,'ACCEPT'));
    const repair=join(f.dir,'repair');await g(f.dir,'clone','-b','agents/coord',f.bare,repair);await g(repair,'config','user.name','Fixture');await g(repair,'config','user.email','fixture@example.test');
    const path=join(repair,'tasks/T1.json'),t=JSON.parse(await readFile(path,'utf8'));t.accepted_sha='0'.repeat(40);await writeFile(path,JSON.stringify(t));await g(repair,'add','.');await g(repair,'commit','-m','tamper\n\nAscend-Coord-Seq: 7\nAscend-Coord-Op: manual\nAscend-Coord-Actor: human\nAscend-Coord-Task: T1');await g(repair,'push','origin','HEAD:agents/coord');
    const r=await run(f.codex,'codex','promote','T1','--as','codex');assert.equal(r.code,3,r.err);assert.match(r.err,/COORD_INVALID|COORD_FOREIGN_COMMIT/);
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('T19 baseline movement during push retries with a proven overlay',async()=>{
  const f=await setup();try{
    await add(f,{...task(),promote_mode:'overlay_allowed'});await run(f.codex,'codex','claim','T1','--as','codex');await writeFile(join(f.codex,'a.txt'),'accepted\n');const p=parsed(await run(f.codex,'codex','freeze','T1','--as','codex'));
    await run(f.claude,'claude','review-start','T1','--as','claude','--worktree',join(f.dir,'review'));const tree=(await g(f.codex,'rev-parse',`${p.sha}^{tree}`)).out.trim();await run(f.claude,'claude','review-result','T1','--as','claude','--result',await result(f,1,p.sha,tree,'ACCEPT'));
    await writeFile(join(f.claude,'b.txt'),'competing\n');await g(f.claude,'add','b.txt');await g(f.claude,'commit','-m','competing');const competitor=(await g(f.claude,'rev-parse','HEAD')).out.trim();await g(f.claude,'push','origin',`${competitor}:refs/heads/competing`);
    await g(f.codex,'fetch','origin','competing');
    const r=await command(f.codex,'node',[cli,'promote','T1','--as','codex','--json'],{ASCEND_AGENT:'codex',NODE_ENV:'test',ASCEND_AGENT_TEST_FAULT:'baseline_move_once',ASCEND_AGENT_TEST_COMPETITOR:competitor});assert.equal(r.code,0,r.err);assert.equal(parsed(r).mode,'overlay');
    const tip=(await g(f.codex,'ls-remote','origin','refs/heads/dev')).out.split('\t')[0];assert.equal((await g(f.codex,'show',`${tip}:a.txt`)).out,'accepted\n');assert.equal((await g(f.codex,'show',`${tip}:b.txt`)).out,'competing\n');
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('linked worktree stores session and gate logs through git-path',async()=>{
  const f=await setup({noop:{cmd:['node','-e','process.exit(0)'],cwd:'.',timeout_s:10}});try{
    const wt=join(f.dir,'builder-worktree');assert.equal((await g(f.codex,'worktree','add','-b','builder',wt,'dev')).code,0);await add(f,{...task(),required_gates:['noop']});
    const claim=await run(wt,'codex','claim','T1','--as','codex');assert.equal(claim.code,0,claim.err);await writeFile(join(wt,'a.txt'),'worktree edit\n');
    const freeze=await run(wt,'codex','freeze','T1','--as','codex');assert.equal(freeze.code,0,freeze.err);
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('T04 forbidden conflict copy and blocked carve-out fail freeze',async()=>{
  for(const [write,blocked,path] of [['**',[],'x 2.ts'],['a/**',['a/secret/**'],'a/secret/x.ts']]){
    const f=await setup();try{await add(f,{...task(),write_paths:[write],blocked_paths:blocked});await run(f.codex,'codex','claim','T1','--as','codex');
      const target=join(f.codex,path);await mkdir(resolve(target,'..'),{recursive:true});await writeFile(target,'forbidden\n');const r=await run(f.codex,'codex','freeze','T1','--as','codex');assert.equal(r.code,1,r.err);assert.match(r.err,/UNAUTHORIZED_PATHS/);
    }finally{await rm(f.dir,{recursive:true,force:true});}
  }
});
test('T06 review ref movement during review and before promote invalidates',async()=>{
  for(const phase of ['REVIEWING','ACCEPTED']){
    const f=await setup();try{await add(f,task());await run(f.codex,'codex','claim','T1','--as','codex');await writeFile(join(f.codex,'a.txt'),'reviewed\n');const p=parsed(await run(f.codex,'codex','freeze','T1','--as','codex'));
      await run(f.claude,'claude','review-start','T1','--as','claude','--worktree',join(f.dir,'review'));const tree=(await g(f.codex,'rev-parse',`${p.sha}^{tree}`)).out.trim(),file=await result(f,1,p.sha,tree,'ACCEPT');
      if(phase==='ACCEPTED')assert.equal((await run(f.claude,'claude','review-result','T1','--as','claude','--result',file)).code,0);
      const base=(await g(f.codex,'rev-parse','HEAD~1')).out.trim();await g(f.bare,'update-ref','refs/heads/review/t1-r1',base);
      const r=phase==='REVIEWING'?await run(f.claude,'claude','review-result','T1','--as','claude','--result',file):await run(f.codex,'codex','promote','T1','--as','codex');assert.equal(r.code,6,r.err);
      assert.equal(parsed(await run(f.codex,'codex','status','--task','T1')).tasks[0].state,'BLOCKED');
    }finally{await rm(f.dir,{recursive:true,force:true});}
  }
});
test('T07 abbreviated result SHA is usage error',async()=>{
  const f=await setup();try{await add(f,task());await run(f.codex,'codex','claim','T1','--as','codex');await writeFile(join(f.codex,'a.txt'),'reviewed\n');const p=parsed(await run(f.codex,'codex','freeze','T1','--as','codex'));
    await run(f.claude,'claude','review-start','T1','--as','claude','--worktree',join(f.dir,'review'));const tree=(await g(f.codex,'rev-parse',`${p.sha}^{tree}`)).out.trim(),file=await result(f,1,p.sha.slice(0,12),tree,'ACCEPT');
    const r=await run(f.claude,'claude','review-result','T1','--as','claude','--result',file);assert.equal(r.code,2,r.err);assert.match(r.err,/SHA_FORMAT/);
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('T14 same agent can resume a claim in a new worktree',async()=>{
  const f=await setup();try{await add(f,task());assert.equal((await run(f.codex,'codex','claim','T1','--as','codex')).code,0);
    const wt=join(f.dir,'new-builder');await g(f.codex,'worktree','add','-b','new-builder',wt,'dev');const r=await run(wt,'codex','claim','T1','--as','codex','--resume');assert.equal(r.code,0,r.err);
    const tip=(await g(wt,'ls-remote','origin','refs/heads/agents/coord')).out.split('\t')[0],log=(await g(wt,'show',`${tip}:activity.jsonl`)).out;assert.match(log,/task\.claim_resumed/);
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('T25 unchanged evidence reuse is accepted',async()=>{
  const f=await setup();try{await add(f,{...task(),write_paths:['a.txt','b.txt']});await run(f.codex,'codex','claim','T1','--as','codex');await writeFile(join(f.codex,'a.txt'),'one\n');const p1=parsed(await run(f.codex,'codex','freeze','T1','--as','codex'));
    await run(f.claude,'claude','review-start','T1','--as','claude','--worktree',join(f.dir,'review1'));const tree1=(await g(f.codex,'rev-parse',`${p1.sha}^{tree}`)).out.trim();const finding={id:'F1',blocking:true,severity:'high',paths:['b.txt'],observed:'missing',expected:'update',minimal_repair:'update b',regression_proof:{kind:'manual',description:'read'},requires_scope_change:false};await run(f.claude,'claude','review-result','T1','--as','claude','--result',await result(f,1,p1.sha,tree1,'FIX_REQUIRED',[finding]));
    await writeFile(join(f.codex,'b.txt'),'two\n');const p2=parsed(await run(f.codex,'codex','freeze','T1','--as','codex'));await run(f.claude,'claude','review-start','T1','--as','claude','--worktree',join(f.dir,'review2'));
    const tree2=(await g(f.codex,'rev-parse',`${p2.sha}^{tree}`)).out.trim(),file=await result(f,2,p2.sha,tree2,'ACCEPT');const data=JSON.parse(await readFile(file,'utf8'));data.prior_findings=[{id:'F1',disposition:'resolved',evidence:'b updated'}];data.evidence_reuse=[{from_round:1,item:'a check',paths:['a.txt']}];await writeFile(file,JSON.stringify(data));
    const r=await run(f.claude,'claude','review-result','T1','--as','claude','--result',file);assert.equal(r.code,0,r.err);
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('T18 overlap, read-path change, and ff-only policy require a new review',async()=>{
  for(const [mode,read,competitorPath] of [['overlay_allowed',[],'a.txt'],['overlay_allowed',['b.txt'],'b.txt'],['ff_only',[],'b.txt']]){
    const f=await setup();try{await add(f,{...task(),read_paths:read,promote_mode:mode});await run(f.codex,'codex','claim','T1','--as','codex');await writeFile(join(f.codex,'a.txt'),'accepted\n');const p=parsed(await run(f.codex,'codex','freeze','T1','--as','codex'));
      await run(f.claude,'claude','review-start','T1','--as','claude','--worktree',join(f.dir,'review'));const tree=(await g(f.codex,'rev-parse',`${p.sha}^{tree}`)).out.trim();await run(f.claude,'claude','review-result','T1','--as','claude','--result',await result(f,1,p.sha,tree,'ACCEPT'));
      await writeFile(join(f.claude,competitorPath),'baseline moved\n');await g(f.claude,'add',competitorPath);await g(f.claude,'commit','-m','competing');assert.equal((await g(f.claude,'push','origin','HEAD:dev')).code,0);
      const r=await run(f.codex,'codex','promote','T1','--as','codex');assert.equal(r.code,1,r.err);assert.match(r.err,/SYS_REBASE/);assert.equal(parsed(await run(f.codex,'codex','status','--task','T1')).tasks[0].state,'FIX_REQUIRED');
    }finally{await rm(f.dir,{recursive:true,force:true});}
  }
});
test('T13 orphan review ref from interrupted push is adopted on retry',async()=>{
  const f=await setup();try{await add(f,task());await run(f.codex,'codex','claim','T1','--as','codex');await writeFile(join(f.codex,'a.txt'),'candidate\n');
    const interrupted=await command(f.codex,'node',[cli,'freeze','T1','--as','codex','--json'],{ASCEND_AGENT:'codex',NODE_ENV:'test',ASCEND_AGENT_TEST_FAULT:'after_review_ref'});assert.equal(interrupted.code,5,interrupted.err);
    const ref=(await g(f.codex,'ls-remote','origin','refs/heads/review/t1-r1')).out.split('\t')[0];assert.match(ref,/^[0-9a-f]{40}$/);assert.equal(parsed(await run(f.codex,'codex','status','--task','T1')).tasks[0].state,'IMPLEMENTING');
    const retried=await run(f.codex,'codex','freeze','T1','--as','codex');assert.equal(retried.code,0,retried.err);assert.equal(parsed(retried).sha,ref);
    const tip=(await g(f.codex,'ls-remote','origin','refs/heads/agents/coord')).out.split('\t')[0],log=(await g(f.codex,'show',`${tip}:activity.jsonl`)).out;assert.equal((log.match(/review\.published/g)||[]).length,1);
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('T13 outcome-unknown after successful push converges on retry',async()=>{
  const f=await setup();try{await add(f,task());await run(f.codex,'codex','claim','T1','--as','codex');await writeFile(join(f.codex,'a.txt'),'candidate\n');
    const interrupted=await command(f.codex,'node',[cli,'freeze','T1','--as','codex','--json'],{ASCEND_AGENT:'codex',NODE_ENV:'test',ASCEND_AGENT_TEST_FAULT:'after_coord_push'});assert.equal(interrupted.code,5,interrupted.err);
    const remote=(await g(f.codex,'ls-remote','origin','refs/heads/review/t1-r1')).out.split('\t')[0];assert.match(remote,/^[0-9a-f]{40}$/);
    const retried=await run(f.codex,'codex','freeze','T1','--as','codex');assert.equal(retried.code,0,retried.err);assert.equal(parsed(retried).sha,remote);
    const tip=(await g(f.codex,'ls-remote','origin','refs/heads/agents/coord')).out.split('\t')[0],log=(await g(f.codex,'show',`${tip}:activity.jsonl`)).out;assert.equal((log.match(/review\.published/g)||[]).length,1);
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('T12 malformed coord JSON stops reads and mutations',async()=>{
  const f=await setup();try{await add(f,task());const repair=join(f.dir,'repair');await g(f.dir,'clone','-b','agents/coord',f.bare,repair);await g(repair,'config','user.name','Fixture');await g(repair,'config','user.email','fixture@example.test');
    await writeFile(join(repair,'tasks/T1.json'),'{broken');await g(repair,'add','.');await g(repair,'commit','-m','bad json\n\nAscend-Coord-Seq: 3\nAscend-Coord-Op: manual\nAscend-Coord-Actor: human\nAscend-Coord-Task: T1');await g(repair,'push','origin','HEAD:agents/coord');
    assert.equal((await run(f.codex,'codex','status')).code,3);assert.equal((await run(f.codex,'codex','claim','T1','--as','codex')).code,3);
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('T20 rewritten coord ref is detected from last seen tip',async()=>{
  const f=await setup();try{await add(f,task());const baseline=(await g(f.codex,'rev-parse','HEAD')).out.trim();await g(f.bare,'update-ref','refs/heads/agents/coord',baseline);
    const r=await run(f.codex,'codex','status');assert.equal(r.code,3,r.err);assert.match(r.err,/COORD_REWRITTEN/);
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
