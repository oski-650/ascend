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
const events=async f=>{const tip=(await g(f.codex,'ls-remote','origin','refs/heads/agents/coord')).out.split('\t')[0];return (await g(f.codex,'show',`${tip}:activity.jsonl`)).out.trim().split('\n').map(JSON.parse);};
const F=(id,paths=['a.txt'])=>({id,blocking:true,severity:'high',paths,line:1,observed:'o',expected:'e',minimal_repair:'r',regression_proof:{kind:'manual',description:'d'},requires_scope_change:false,suggested_patch:null});
async function published(f,t=task()){await add(f,t);await run(f.codex,'codex','claim',t.id,'--as','codex');await writeFile(join(f.codex,'a.txt'),'r1\n');const r=parsed(await run(f.codex,'codex','freeze',t.id,'--as','codex'));r.tree=(await g(f.codex,'rev-parse',`${r.sha}^{tree}`)).out.trim();return r;}

test('P1 bracketed Next.js route path can be frozen under a covering glob',async()=>{
  const f=await setup();try{const t={...task('T1','app/**')};await add(f,t);await run(f.codex,'codex','claim','T1','--as','codex');
    await mkdir(join(f.codex,'app/[id]'),{recursive:true});await writeFile(join(f.codex,'app/[id]/page.tsx'),'x\n');
    const r=await run(f.codex,'codex','freeze','T1','--as','codex');assert.equal(r.code,0,r.err);assert.equal((await run(f.codex,'codex','verify')).code,0);
    const review=await run(f.claude,'claude','review-start','T1','--as','claude');assert.equal(review.code,0,review.err);assert.ok(parsed(review).worktree.startsWith(tmpdir()));await g(f.claude,'worktree','remove','--force',parsed(review).worktree);
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('P2 gates are not re-run when coord moves during freeze',async()=>{
  const counter=join(tmpdir(),`probe-counter-${process.pid}`);await rm(counter,{force:true});
  const f=await setup({slow:{cmd:['sh','-c',`echo run >> ${counter}; sleep 5`],cwd:'.',timeout_s:60}});try{
    await add(f,{...task('T1','a.txt'),required_gates:['slow']});await add(f,{...task('T2','b.txt'),builder:'claude',reviewer:'codex'});
    await run(f.codex,'codex','claim','T1','--as','codex');await writeFile(join(f.codex,'a.txt'),'r1\n');await g(f.codex,'add','a.txt');await g(f.codex,'commit','-m','w');
    const freezing=run(f.codex,'codex','freeze','T1','--as','codex');await new Promise(r=>setTimeout(r,2000));
    const c=await run(f.claude,'claude','claim','T2','--as','claude');const fr=await freezing;
    const runs=(await readFile(counter,'utf8')).trim().split('\n').length;assert.equal(c.code,0,c.err);assert.equal(fr.code,0,fr.err);assert.equal(runs,1);
  }finally{await rm(f.dir,{recursive:true,force:true});await rm(counter,{force:true});}
});
test('P3 ingest by codex records the invoker and declared reviewer separately',async()=>{
  const f=await setup();try{const r=await published(f);await run(f.claude,'claude','review-start','T1','--as','claude','--worktree',join(f.dir,'rv'));
    const p=join(f.dir,'forged.json');await writeFile(p,JSON.stringify({task:'T1',reviewer:'claude',session:'claude-forged',round:1,reviewed_sha:r.sha,reviewed_tree:r.tree,verdict:'ACCEPT',findings:[],prior_findings:[],manual_checks:[],evidence_reuse:[],notes:''}));
    const x=await run(f.codex,'codex','ingest',p,'--as','codex');const last=(await events(f)).at(-1);assert.equal(x.code,0,x.err);assert.equal(last.actor.id,'codex');assert.equal(last.data.declared_reviewer,'claude');assert.equal(last.data.ingested_by,'codex');
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('P4 promote-time invalidation is attributed to the promoter',async()=>{
  const f=await setup();try{const r=await published(f);await run(f.claude,'claude','review-start','T1','--as','claude','--worktree',join(f.dir,'rv'));
    await run(f.claude,'claude','review-result','T1','--as','claude','--result',await result(f,1,r.sha,r.tree,'ACCEPT'));
    await g(f.dir,'--git-dir',f.bare,'update-ref','refs/heads/review/t1-r1',(await g(f.codex,'rev-parse',`${r.sha}^`)).out.trim());
    const x=await run(f.codex,'codex','promote','T1','--as','codex');const last=(await events(f)).at(-1);assert.equal(x.code,6,x.err);assert.equal(last.actor.id,'codex');
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('P4 admin promote invalidation is attributed to the human',async()=>{
  const f=await setup();try{const r=await published(f);await run(f.claude,'claude','review-start','T1','--as','claude','--worktree',join(f.dir,'rv'));
    await run(f.claude,'claude','review-result','T1','--as','claude','--result',await result(f,1,r.sha,r.tree,'ACCEPT'));
    await g(f.dir,'--git-dir',f.bare,'update-ref','refs/heads/review/t1-r1',(await g(f.codex,'rev-parse',`${r.sha}^`)).out.trim());
    const x=await admin(f.codex,'promote','T1');const last=(await events(f)).at(-1);assert.equal(x.code,6,x.err);assert.equal(last.actor.kind,'human');assert.equal(last.actor.id,'oscar');
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('P5 prior blocking finding requires disposition and still-open carryover',async()=>{
  const f=await setup();try{let r=await published(f);await run(f.claude,'claude','review-start','T1','--as','claude','--worktree',join(f.dir,'rv1'));
    await run(f.claude,'claude','review-result','T1','--as','claude','--result',await result(f,1,r.sha,r.tree,'FIX_REQUIRED',[F('T1-r1-F1')]));
    await writeFile(join(f.codex,'a.txt'),'r2\n');r=parsed(await run(f.codex,'codex','freeze','T1','--as','codex'));r.tree=(await g(f.codex,'rev-parse',`${r.sha}^{tree}`)).out.trim();
    await run(f.claude,'claude','review-start','T1','--as','claude','--worktree',join(f.dir,'rv2'));
    const missing=await result(f,2,r.sha,r.tree,'FIX_REQUIRED',[F('T1-r2-F2')]);const refused=await run(f.claude,'claude','review-result','T1','--as','claude','--result',missing);assert.equal(refused.code,1,refused.err);assert.match(refused.err,/PRIOR_FINDING/);
    const input=JSON.parse(await readFile(missing,'utf8'));input.prior_findings=[{id:'T1-r1-F1',disposition:'still_open',evidence:'still fails'}];
    await writeFile(missing,JSON.stringify({...input,verdict:'ACCEPT',findings:[]}));const premature=await run(f.claude,'claude','review-result','T1','--as','claude','--result',missing);assert.equal(premature.code,1,premature.err);assert.match(premature.err,/PRIOR_FINDING/);
    await writeFile(missing,JSON.stringify(input));const x=await run(f.claude,'claude','review-result','T1','--as','claude','--result',missing);
    const tip=(await g(f.codex,'ls-remote','origin','refs/heads/agents/coord')).out.split('\t')[0];const t=JSON.parse((await g(f.claude,"show",`${tip}:tasks/T1.json`)).out);
    assert.equal(x.code,0,x.err);assert.deepEqual(t.open_findings.map(y=>y.id),['T1-r1-F1','T1-r2-F2']);
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('P6 free-text block reason is a usage error',async()=>{
  const f=await setup();try{await add(f,task());await run(f.codex,'codex','claim','T1','--as','codex');
    const x=await run(f.codex,'codex','block','T1','--as','codex','--reason','waiting on oscar');assert.equal(x.code,2,x.err);assert.match(x.err,/BLOCK_REASON/);
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('P7 candidate gate registry cannot replace the committed baseline command',async()=>{
  const f=await setup({safe:{cmd:['node','-e','process.stdout.write("baseline\\n")'],cwd:'.',timeout_s:10}});try{
    await add(f,{...task('T1','**'),required_gates:['safe']});await run(f.codex,'codex','claim','T1','--as','codex');
    await writeFile(join(f.codex,'a.txt'),'candidate\n');await writeFile(join(f.codex,'tools/agent/gates.json'),JSON.stringify({safe:{cmd:['node','-e','process.exit(77)'],cwd:'.',timeout_s:10}}));
    const freeze=await run(f.codex,'codex','freeze','T1','--as','codex');assert.equal(freeze.code,0,freeze.err);
    const tip=(await g(f.codex,'ls-remote','origin','refs/heads/agents/coord')).out.split('\t')[0];const manifest=JSON.parse((await g(f.codex,'show',`${tip}:reviews/T1/r1.json`)).out);
    assert.deepEqual(manifest.gates[0].command,['node','-e','process.stdout.write("baseline\\n")']);
    const base=(await g(f.codex,'rev-parse',`${manifest.baseline}:tools/agent/gates.json`)).out.trim();assert.equal(manifest.gates[0].registry_blob_sha,base);
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('P8 claim prepares a work branch without switching checkout',async()=>{
  const f=await setup();try{await add(f,task());const before=(await g(f.codex,'branch','--show-current')).out.trim();const claim=await run(f.codex,'codex','claim','T1','--as','codex');assert.equal(claim.code,0,claim.err);assert.equal(parsed(claim).branch,'work/t1');assert.equal((await g(f.codex,'branch','--show-current')).out.trim(),before);assert.equal((await g(f.codex,'rev-parse','work/t1')).out.trim(),(await g(f.codex,'rev-parse','HEAD')).out.trim());
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('P9 review branch created during push reports branch collision',async()=>{
  const f=await setup();try{await add(f,task());await run(f.codex,'codex','claim','T1','--as','codex');const base=(await g(f.codex,'rev-parse','HEAD')).out.trim();await writeFile(join(f.codex,'a.txt'),'candidate\n');
    const hook=join(f.codex,'.git/hooks/pre-push');await writeFile(hook,`#!/bin/sh\ngit --git-dir='${f.bare}' update-ref refs/heads/review/t1-r1 '${base}'\n`,{mode:0o755});
    const freeze=await run(f.codex,'codex','freeze','T1','--as','codex');assert.equal(freeze.code,1,freeze.err);assert.match(freeze.err,/BRANCH_COLLISION/);
    assert.equal(parsed(await run(f.codex,'codex','status','--task','T1')).tasks[0].state,'IMPLEMENTING');
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
