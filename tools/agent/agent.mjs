#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { randomUUID } from 'node:crypto';
import { hostname, tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { canonicalJSON, sha256, isSha40 } from './lib/canon.mjs';
import { matches, validatePattern } from './lib/paths.mjs';
import { slugOf, validateTask, validateResult, LOCKED, BLOCK_REASONS } from './lib/schema.mjs';
import { event, transition, nextFor, validateWhole } from './lib/state.mjs';
import { git, gitPath, revParse, lsRemote, isAncestor, treeOf, objectType, diffNames, diffRaw, statusPaths, worktreeAdd, push } from './lib/git.mjs';
import { readTip, loadState, casMutate, initCoord, attestRepair, CoordError } from './lib/coord.mjs';
import { buildChanges, changesSha, deltaFromPrevious } from './lib/manifest.mjs';
import { runGates, loadGateRegistry, GateError } from './lib/gates.mjs';
import { ffOrOverlay } from './lib/promote.mjs';

class Refusal extends Error{constructor(code,message,exit=1){super(message);this.code=code;this.exit=exit;}}
const args=process.argv.slice(2), cmd=args[0], sub=cmd==='admin'?args[1]:null;
const arg=(flag)=>{const i=args.indexOf(flag);return i<0?null:args[i+1]??null;};
const has=flag=>args.includes(flag), json=has('--json');
function fail(code,message,exit=1){throw new Refusal(code,message,exit);}
function emit(data){if(json)process.stdout.write(canonicalJSON(data)+'\n');else for(const [key,value] of Object.entries(data))process.stdout.write(`${key.toUpperCase()}: ${typeof value==='object'?JSON.stringify(value):value}\n`);}
const as=arg('--as');
function identity(){if(!as||!['codex','claude'].includes(as)||as!==process.env.ASCEND_AGENT)fail('IDENTITY','--as must equal ASCEND_AGENT=codex|claude',2);return as;}
async function human(s,id){if(process.env.ASCEND_AGENT)fail('ADMIN_AGENT','unset ASCEND_AGENT before admin',2);const name=arg('--human'),reason=arg('--reason');
  if(!name||!reason||!reason.trim())fail('ADMIN_ARGS','--human and --reason required',2);
  if(s&&!s.config.humans.includes(name))fail('UNKNOWN_HUMAN',name,2);
  if(!(process.env.NODE_ENV==='test'&&process.env.ASCEND_AGENT_TEST_CONFIRM==='1')){
    if(!process.stdin.isTTY)fail('TTY_REQUIRED','admin confirmation requires a TTY',2);
    const rl=createInterface({input:process.stdin,output:process.stdout});const answer=await rl.question(`Type ${id} to confirm: `);rl.close();if(answer!==id)fail('NOT_CONFIRMED','confirmation mismatch',1);
  }
  return {kind:'human',id:name,session:'human',host:hostname()};
}
async function session(cwd,agent){const p=await gitPath(cwd,'ascend-agent/session.json');let o;try{o=JSON.parse(await readFile(p,'utf8'));}catch{}if(o?.agent===agent&&o.session_id)return o.session_id;await mkdir(dirname(p),{recursive:true});o={agent,session_id:`${agent}-${randomUUID()}`};await writeFile(p,canonicalJSON(o,{pretty:true}));return o.session_id;}
function agentCtx(agent,session){return {as:agent,session,actor:{kind:'agent',id:agent,session,host:hostname()}};}
async function baseline(s,cwd){const ref=s.config.baseline_ref;const sha=await lsRemote(ref,cwd);if(!sha)fail('BASELINE_MISSING',ref,4);await git(['fetch','origin',`${ref}:refs/remotes/origin/ascend-baseline`],{cwd});return sha;}
async function gateNames(s,cwd){const sha=await baseline(s,cwd);return new Set(Object.keys((await loadGateRegistry(cwd,sha)).entries));}
async function state(cwd){return loadState(await readTip(cwd),cwd);}
function get(s,id){const t=s.tasks[id];if(!t)fail('NO_TASK',id);return t;}
function checkResultRules(t,r){const errors=validateResult(r);if(errors.length)fail('RESULT_INVALID',errors.join(', '),2);
  if(r.verdict==='FIX_REQUIRED'&&!r.findings.some(f=>f.blocking)&&!r.prior_findings.some(x=>x.disposition==='still_open'))fail('FINDING_REQUIRED','FIX_REQUIRED needs a blocking finding');
  for(const f of t.open_findings){const disposition=r.prior_findings.find(x=>x.id===f.id);if(!disposition||!['resolved','still_open'].includes(disposition.disposition))fail('PRIOR_FINDING',f.id);if(r.verdict==='ACCEPT'&&disposition.disposition!=='resolved')fail('PRIOR_FINDING',f.id);}
  if(r.verdict==='ACCEPT'){
    if(r.findings.some(f=>f.blocking))fail('BLOCKING_FINDING','ACCEPT has blocking findings');
    for(const c of t.required_manual_checks)if(!r.manual_checks.some(x=>x.id===c.id&&x.result==='pass'))fail('MANUAL_CHECK',c.id);
  }
}
async function verifyReview(s,t,cwd){
  const r=t.review;if(!r)fail('NO_REVIEW',t.id,6);
  const ref=`refs/heads/${r.branch}`,remote=await lsRemote(ref,cwd);
  if(remote!==r.sha)return false;
  await git(['fetch','origin',ref],{cwd});
  if(await objectType(r.sha,cwd)!=='commit'||await treeOf(r.sha,cwd)!==r.tree)return false;
  const manifest=s.files[`reviews/${t.id}/r${r.round}.json`];if(!manifest||manifest.sha!==r.sha||manifest.tree!==r.tree)return false;
  const changes=await buildChanges(manifest.baseline,r.sha,cwd);
  if(changesSha(changes)!==manifest.changes_sha256)return false;
  if(!await isAncestor(manifest.baseline,r.sha,cwd)||!await isAncestor(manifest.baseline,await baseline(s,cwd),cwd))return false;
  if(changes.some(x=>!t.write_paths.some(p=>matches(p,x.path))||t.blocked_paths.some(p=>matches(p,x.path))))return false;
  return true;
}
async function invalidate(cwd,id,actor){await casMutate(cwd,'invalidate',actor.id,s=>{const t=get(s,id);return transition(s,'invalidate',{id,as:actor.id,reason:'REVIEW_OBJECT_MOVED',note:'review ref, tree or manifest mismatch',actor});});fail('REVIEW_INVALIDATED',id,6);}
async function checkedTransition(cwd,op,ctx){const r=await casMutate(cwd,op,ctx.actor.id,s=>{const x=transition(s,op,ctx);if(!x.ok)return x;return {task:ctx.id};});if(r.ok===false)fail(r.code,r.reason);return r;}
async function adminCommand(cwd){
  if(sub==='init'){
    const actor=await human(null,'agents/coord'),ref=arg('--baseline-ref');if(!ref||ref==='refs/heads/main'||!ref.startsWith('refs/heads/'))fail('BASELINE_REF','invalid baseline ref',2);
    const sha=await lsRemote(ref,cwd);if(!isSha40(sha))fail('BASELINE_MISSING',ref,4);
    const config={schema_version:1,baseline_ref:ref,remote:'origin',agents:{codex:{kinds:['builder','reviewer']},claude:{kinds:['builder','reviewer']}},humans:[actor.id],forbidden_name_patterns:['**/* 2.*','**/.env*'],stale_after_hours:8,genesis:{baseline_sha:sha,seq:1}};
    emit({initialized:await initCoord(cwd,config,actor),baseline:sha});return;
  }
  if(sub==='attest-repair'){const actor=await human(null,'agents/coord');emit({attested:await attestRepair(cwd,actor,arg('--reason'))});return;}
  const s=await state(cwd),id=args[2],confirmId=['task-add','import'].includes(sub)?JSON.parse(await readFile(id,'utf8')).id:id||sub,actor=await human(s,confirmId),ctx={id,human:true,actor,reason:arg('--reason')};
  if(sub==='task-add'||sub==='import'){
    const input=JSON.parse(await readFile(id,'utf8'));
    const t={...input,slug:input.slug||slugOf(input.id),state:input.state||'AVAILABLE',baseline_sha:input.baseline_sha??null,round:input.round??0,rounds:input.rounds||[],review:input.review??null,accepted_sha:input.accepted_sha??null,accepted_tree:input.accepted_tree??null,promoted:input.promoted??null,read_paths:input.read_paths||[],blocked_paths:input.blocked_paths||[],prerequisites:input.prerequisites||[],required_gates:input.required_gates||[],promotion_gates:input.promotion_gates||[],required_manual_checks:input.required_manual_checks||[],open_findings:input.open_findings||[],read_first:input.read_first||[],promote_policy:input.promote_policy||'approval',promote_mode:input.promote_mode||'ff_only',claim:input.claim??null,blocked:input.blocked??null,legacy:sub==='import',updated_seq:0};
    const result=await casMutate(cwd,sub,actor.id,async s2=>{const names=await gateNames(s2,cwd),unknown=[...t.required_gates,...t.promotion_gates].filter(x=>!names.has(x));if(unknown.length)return {ok:false,code:'UNKNOWN_GATE',reason:unknown.join(', ')};const x=transition(s2,sub==='import'?'import':'task-add',{...ctx,task:t,actor});if(!x.ok)return x;return {task:t.id};});if(!result.ok)fail(result.code,result.reason);emit({task:t.id,state:t.state});return;
  }
  if(sub==='task-edit'){
    const newTask=JSON.parse(await readFile(args[3],'utf8'));
    const r=await casMutate(cwd,sub,actor.id,async s2=>{const t=get(s2,id);if(!['AVAILABLE','BLOCKED'].includes(t.state)||t.state==='BLOCKED'&&t.blocked.reason!=='SCOPE_CHANGE_REQUIRED')return {ok:false,code:'EDIT_STATE',reason:t.state};const next={...t,...newTask,id:t.id,slug:t.slug,state:t.state,updated_seq:t.updated_seq};const errors=validateTask(next,s2.config);if(errors.length)return {ok:false,code:'INVALID_TASK',reason:errors.join(', ')};const names=await gateNames(s2,cwd),unknown=[...next.required_gates,...next.promotion_gates].filter(x=>!names.has(x));if(unknown.length)return {ok:false,code:'UNKNOWN_GATE',reason:unknown.join(', ')};s2.tasks[id]=next;event(s2,'task.edited',{actor,from:t.state,override:true},next,{reason:ctx.reason});return {task:id};});if(!r.ok)fail(r.code,r.reason);emit({task:id,state:'EDITED'});return;
  }
  if(sub==='approve-promote'){
    const r=await casMutate(cwd,sub,actor.id,s2=>{const t=get(s2,id);if(t.state!=='ACCEPTED')return {ok:false,code:'NOT_ACCEPTED',reason:id};event(s2,'promote.approved',{actor,from:t.state},t,{sha:t.accepted_sha});return {task:id};});if(!r.ok)fail(r.code,r.reason);emit({approved:id});return;
  }
  const map={'unblock':'unblock','release':'release','abandon':'abandon'};
  if(map[sub]){if(sub==='unblock'){const t=get(s,id);if(t.state==='BLOCKED'&&['PUBLISHED','REVIEWING','ACCEPTED'].includes(t.blocked.from)&&!await verifyReview(s,t,cwd))fail('REVIEW_INVALIDATED','restore the recorded review ref before unblock',6);}const r=await checkedTransition(cwd,map[sub],ctx);emit({task:id,state:map[sub].toUpperCase(),seq:r.tip});return;}
  if(sub==='promote'){await promoteCommand(cwd,id,null,actor);return;}
  fail('UNKNOWN_ADMIN',sub,2);
}
async function freeze(cwd,id,agent,sess){
  const actor=agentCtx(agent,sess).actor,wt=sha256(hostname()+cwd),dry=has('--dry-run');
  const initial=await state(cwd),task=get(initial,id),head=await revParse('HEAD',cwd);
  if(task.state==='PUBLISHED'&&task.review?.sha===head){emit({published:id,round:task.round,sha:head,branch:task.review.branch,already_published:true});return;}
  if(!['IMPLEMENTING','FIX_REQUIRED'].includes(task.state)||task.builder!==agent||task.claim?.agent!==agent||task.claim.worktree_id!==wt)fail('NOT_CLAIMED',id);
  const d=await baseline(initial,cwd);let b=d;
  if(!await isAncestor(d,head,cwd)){
    b=task.baseline_sha;
    if(!await isAncestor(b,d,cwd)||!await isAncestor(b,head,cwd))fail('BASELINE_REWRITTEN',id);
    const moved=await diffNames(b,d,cwd);
    if(moved.some(p=>[...task.write_paths,...task.read_paths].some(x=>matches(x,p))))fail('BASELINE_MOVED_CONFLICT',moved.join(', '));
  }
  const dirtyPaths=await statusPaths(cwd),candidate=[...new Set([...(await diffNames(b,head,cwd)),...dirtyPaths])];
  const invalid=candidate.filter(p=>!task.write_paths.some(x=>matches(x,p))||task.blocked_paths.some(x=>matches(x,p))||initial.config.forbidden_name_patterns.some(x=>matches(x,p)));
  if(invalid.length)fail('UNAUTHORIZED_PATHS',invalid.join(', '));
  const round=task.round+1;
  if(dirtyPaths.length&&!dry){await git(['add','-A','--',...dirtyPaths],{cwd});await git(['commit','-m',`${id} r${round}\n\nAscend-Task: ${id}\nAscend-Round: ${round}\nAscend-Baseline: ${b}`],{cwd});}
  if((await statusPaths(cwd)).length&&!dry)fail('TREE_DIRTY_AFTER_COMMIT',id);
  const sha=await revParse('HEAD',cwd),tree=await treeOf(sha,cwd),previous=task.rounds.at(-1);
  if(previous&&(previous.sha===sha||previous.tree===tree))fail('NO_CHANGES',id);
  const full=await buildChanges(b,sha,cwd),unauthorized=full.filter(x=>!task.write_paths.some(p=>matches(p,x.path))||task.blocked_paths.some(p=>matches(p,x.path))||initial.config.forbidden_name_patterns.some(p=>matches(p,x.path))||x.new_mode==='160000');
  if(!full.length)fail('NO_CHANGES',id);
  if(unauthorized.length)fail('UNAUTHORIZED_PATHS',unauthorized.map(x=>x.path).join(', '));
  const registry=await loadGateRegistry(cwd,d);
  const evidence=await runGates(task.required_gates,{sha,cwd,registry});
  if(dry){emit({dry_run:id,sha,changes:full.length});return;}
  const branch=`review/${task.slug}-r${round}`,ref=`refs/heads/${branch}`,delta=await deltaFromPrevious(previous?.sha,sha,cwd);
  const result=await casMutate(cwd,'freeze',agent,async s=>{
    const t=get(s,id);
    if(t.state==='PUBLISHED'&&t.review?.sha===sha)return {task:id,round:t.round,sha,branch:t.review.branch,noop:true};
    if(!['IMPLEMENTING','FIX_REQUIRED'].includes(t.state)||t.builder!==agent||t.claim?.worktree_id!==wt||t.round!==round-1)return {ok:false,code:'NOT_CLAIMED',reason:id};
    if(await revParse('HEAD',cwd)!==sha||(await statusPaths(cwd)).length)return {ok:false,code:'TREE_CHANGED_AFTER_GATES',reason:id};
    const currentBaseline=await baseline(s,cwd);
    if(!await isAncestor(b,currentBaseline,cwd))return {ok:false,code:'BASELINE_REWRITTEN',reason:id};
    const moved=await diffNames(b,currentBaseline,cwd);
    if(moved.some(p=>[...t.write_paths,...t.read_paths].some(x=>matches(x,p))))return {ok:false,code:'BASELINE_MOVED_CONFLICT',reason:moved.join(', ')};
    const currentRegistry=await loadGateRegistry(cwd,currentBaseline);
    if(currentRegistry.blobSha!==registry.blobSha)return {ok:false,code:'GATE_REGISTRY_MOVED',reason:id};
    const existing=await lsRemote(ref,cwd);
    if(existing&&existing!==sha)return {ok:false,code:'BRANCH_COLLISION',reason:branch};
    const manifest={task:id,round,branch,sha,tree,baseline:b,previous_round_sha:previous?.sha||null,builder:agent,session:sess,published_seq:s.events.length+1,changes:full,changes_sha256:changesSha(full),delta_from_previous:delta,gates:evidence,gate_evidence_kind:'builder_attested'};
    s.files[`reviews/${id}/r${round}.json`]=manifest;
    const x=transition(s,'publish',{id,as:agent,manifest,actor});if(!x.ok)return x;
    return {task:id,round,sha,branch,refspecs:existing?[]:[`${sha}:${ref}`]};
  });
  if(!result.ok)fail(result.code,result.reason);emit(result.dry_run?{dry_run:id,sha:result.sha,changes:result.changes}:{published:id,round:result.round,sha:result.sha,branch:result.branch});
}
async function reviewStart(cwd,id,agent,sess){
  const s=await state(cwd),t=get(s,id);if(t.reviewer!==agent||!['PUBLISHED','REVIEWING'].includes(t.state))fail('REVIEW_STATE',t.state);
  if(!await verifyReview(s,t,cwd))await invalidate(cwd,id,agentCtx(agent,sess).actor);
  const start=await casMutate(cwd,'review-start',agent,async s2=>{const current=get(s2,id);if(current.review?.sha!==t.review.sha||current.round!==t.round)return {ok:false,code:'REVIEW_STALE',reason:id};if(!await verifyReview(s2,current,cwd)){transition(s2,'invalidate',{id,as:agent,reason:'REVIEW_OBJECT_MOVED',note:'review moved during start',actor:agentCtx(agent,sess).actor});return {task:id,invalidated:true};}const x=transition(s2,'reviewStart',{id,as:agent,session:sess,actor:agentCtx(agent,sess).actor});return x.ok?{task:id}:x;});if(!start.ok)fail(start.code,start.reason,6);if(start.invalidated)fail('REVIEW_INVALIDATED',id,6);
  const path=arg('--worktree')||join(tmpdir(),`ascend-review-${sha256(cwd).slice(0,8)}-${t.slug}-r${t.round}`);
  try{await worktreeAdd(path,t.review.sha,cwd);}catch(e){if(!e.message.includes('already exists')||await revParse('HEAD',path).catch(()=>null)!==t.review.sha)throw e;}
  emit({task:'REVIEW',slice:id,round:t.round,branch:t.review.branch,sha:t.review.sha,tree:t.review.tree,mode:'READ_ONLY',worktree:path});
}
async function reviewResult(cwd,id,agent,sess,input,{emitOnly=false,invoker=agentCtx(agent,sess).actor,ingested=false}={}){
  const r=JSON.parse(await readFile(input,'utf8'));if(!isSha40(r.reviewed_sha)||!isSha40(r.reviewed_tree))fail('SHA_FORMAT','full lowercase 40hex SHA required',2);
  const s=await state(cwd),t=get(s,id);if(t.reviewer!==agent)fail('WRONG_REVIEWER',agent);
  if(t.review?.reviewer_session&&!t.review.reviewer_session.startsWith(`${agent}-`))fail('REVIEW_SESSION','review was started by another reviewer');
  if(t.state!=='REVIEWING'||r.round!==t.round||r.reviewed_sha!==t.review?.sha||r.reviewed_tree!==t.review?.tree||s.files[`reviews/${id}/r${r.round}.result.json`]){
    await casMutate(cwd,'stale-result',invoker.id,s2=>{const x=get(s2,id);event(s2,'review.stale_rejected',{actor:invoker,from:x.state},x,{round:r.round,sha:r.reviewed_sha});return {task:id};});fail('REVIEW_STALE',id,6);
  }
  if(!await verifyReview(s,t,cwd))await invalidate(cwd,id,invoker);
  checkResultRules(t,r);
  for(const reuse of r.evidence_reuse){const old=t.rounds.find(x=>x.n===reuse.from_round);if(!old||!Array.isArray(reuse.paths)||!reuse.paths.length||!reuse.paths.every(validatePattern))fail('EVIDENCE_REUSE','invalid old round or paths');const names=await diffNames(old.sha,t.review.sha,cwd);if(names.some(p=>reuse.paths.some(x=>matches(x,p))))fail('EVIDENCE_CHANGED',names.join(', '));}
  if(emitOnly){const output=arg('--output');if(!output)fail('OUTPUT_REQUIRED','--output required with --emit-only',2);const filled={...r,task:id,reviewer:agent,session:sess};await writeFile(output,canonicalJSON(filled,{pretty:true}));emit({emitted:output,task:id,round:r.round,sha:r.reviewed_sha});return;}
  const result=await casMutate(cwd,'review-result',invoker.id,async s2=>{
    const task=get(s2,id);if(task.state!=='REVIEWING'||task.round!==r.round||task.review.sha!==r.reviewed_sha)return {ok:false,code:'REVIEW_STALE',reason:id};
    if(!await verifyReview(s2,task,cwd)){transition(s2,'invalidate',{id,as:invoker.id,reason:'REVIEW_OBJECT_MOVED',note:'review moved during result',actor:invoker});return {task:id,invalidated:true};}
    const relay=ingested?{ingested_by:invoker.id,declared_reviewer:agent,declared_reviewer_session:sess}:{};
    const filled={...r,task:id,reviewer:agent,session:sess,result_seq:s2.events.length+1,...relay};s2.files[`reviews/${id}/r${r.round}.result.json`]=filled;
    const x=transition(s2,r.verdict==='ACCEPT'?'accept':'fix',{id,as:agent,result:filled,actor:invoker,eventData:relay});if(!x.ok)return x;return {task:id,verdict:r.verdict};
  });if(!result.ok)fail(result.code,result.reason,6);if(result.invalidated)fail('REVIEW_INVALIDATED',id,6);emit({task:id,verdict:r.verdict,sha:r.reviewed_sha});
}
async function promoteCommand(cwd,id,agent,humanActor=null){
  const s=await state(cwd),t=get(s,id);if(t.state==='PROMOTED'){emit({promoted:id,sha:t.promoted.sha,mode:t.promoted.mode});return;}
  if(t.state!=='ACCEPTED')fail('NOT_ACCEPTED',t.state);
  if(!humanActor&&t.builder!==agent)fail('WRONG_BUILDER',agent);
  if(t.promote_policy==='approval'&&!s.events.some(e=>e.type==='promote.approved'&&e.task===id&&e.data.sha===t.accepted_sha))fail('APPROVAL_REQUIRED',id);
  const actor=humanActor||agentCtx(agent,await session(cwd,agent)).actor;
  if(!await verifyReview(s,t,cwd))await invalidate(cwd,id,actor);
  const recorded=s.files[`reviews/${id}/r${t.round}.result.json`];if(!recorded||recorded.verdict!=='ACCEPT'||recorded.reviewed_sha!==t.accepted_sha||recorded.reviewed_tree!==t.accepted_tree||await treeOf(t.accepted_sha,cwd)!==t.accepted_tree)fail('ACCEPTANCE_INVALID',id,3);
  for(let n=0;n<3;n++){
    const d=await baseline(s,cwd),a=t.accepted_sha;
    if(await isAncestor(a,d,cwd)){
      const promoted={sha:d,mode:'recovered',baseline_before:d,tree_proof_sha256:null};await checkedTransition(cwd,'promote',{id,as:agent,human:!!humanActor,promoted,actor});emit({promoted:id,sha:d,mode:'recovered'});return;
    }
    const plan=await ffOrOverlay(t,d,cwd);
    if(plan.mode==='blocked'){await checkedTransition(cwd,'block',{id,as:agent,human:!!humanActor,reason:'BASELINE_REWRITTEN',note:'baseline no longer descends from round baseline',actor});fail('BASELINE_REWRITTEN',id);}
    if(plan.mode==='rebase'){await checkedTransition(cwd,'reopen',{id,as:t.builder,reason:'SYS-REBASE',actor});fail('SYS_REBASE','new review round required');}
    if(plan.mode==='overlay'){
      if((await statusPaths(cwd)).length)fail('DIRTY_WORKTREE','overlay gate requires clean worktree');
      const before=await revParse('HEAD',cwd),branch=(await git(['symbolic-ref','--quiet','--short','HEAD'],{cwd}).catch(()=>'' )).trim();await git(['switch','--detach',plan.sha],{cwd});
      try{await runGates(t.promotion_gates,{sha:plan.sha,cwd,registry:await loadGateRegistry(cwd,d)});}finally{await git(['switch',branch||'--detach',...(branch?[]:[before])],{cwd});}
    }
    try{await push([`${plan.sha}:${s.config.baseline_ref}`],s.config.baseline_ref,cwd);}
    catch(e){if(n<2)continue;fail('BASELINE_PUSH_FAILED',e.message,4);}
    const promoted={...plan,tree_proof_sha256:plan.tree_proof_sha256||null};
    await checkedTransition(cwd,'promote',{id,as:agent,human:!!humanActor,promoted,actor});emit({promoted:id,sha:plan.sha,mode:plan.mode});return;
  }
}
async function main(){
  const cwd=(await git(['rev-parse','--show-toplevel'],{cwd:process.cwd()})).trim();
  if(cmd==='admin'){await adminCommand(cwd);return;}
  if(cmd==='status'||cmd==='verify'||cmd==='next'){
    let s;try{s=await state(cwd);}catch(e){if(cmd==='next')emit({task:'HALT',reason:e.message});throw e;}
    if(cmd==='verify'){const errors=validateWhole(s),base=await baseline(s,cwd);for(const t of Object.values(s.tasks)){for(const r of t.rounds){try{if(await treeOf(r.sha,cwd)!==r.tree)errors.push(`${t.id} r${r.n} tree mismatch`);}catch{errors.push(`${t.id} r${r.n} object missing`);}}if(['PUBLISHED','REVIEWING','ACCEPTED'].includes(t.state)&&await lsRemote(`refs/heads/${t.review.branch}`,cwd)!==t.review.sha)errors.push(`${t.id} review ref moved`);if(t.state==='PROMOTED'&&(!t.accepted_sha||!await isAncestor(t.accepted_sha,base,cwd)))errors.push(`${t.id} accepted SHA not in baseline`);}if(errors.length)fail('VERIFY_FAILED',errors.join('; '),3);emit({verify:'OK',tasks:Object.keys(s.tasks).length});return;}
    if(cmd==='status'){const selected=arg('--task');emit({baseline:await baseline(s,cwd),integrity:'OK',tasks:Object.values(s.tasks).filter(t=>!selected||t.id===selected).map(t=>{const last=s.events.filter(e=>e.task===t.id).at(-1),age_hours=last?Math.floor((Date.now()-Date.parse(last.ts))/3600000):0;return {id:t.id,state:t.state,round:t.round,builder:t.builder,reviewer:t.reviewer,sha:t.review?.sha||null,claim_age_hours:LOCKED.has(t.state)?age_hours:null,stale_possible:LOCKED.has(t.state)&&age_hours>=s.config.stale_after_hours,locks:LOCKED.has(t.state)?t.write_paths:[]};})});return;}
    identity();let n=nextFor(as,s);const wait=Number(arg('--wait')||0),deadline=Date.now()+wait*60000;
    while(n.task==='WAIT'&&Date.now()<deadline){await new Promise(r=>setTimeout(r,60000));s=await state(cwd);n=nextFor(as,s);}emit(n);return;
  }
  const agent=identity(),sess=await session(cwd,agent),id=args[1],ctx={id,...agentCtx(agent,sess)};
  if(!id)fail('TASK_ID_REQUIRED','task id required',2);
  if(cmd==='claim'){
    const result=await casMutate(cwd,'claim',agent,async s=>{const d=await baseline(s,cwd),task=get(s,id);for(const p of task.prerequisites){const prior=s.tasks[p];if(prior?.state!=='PROMOTED'||!await isAncestor(prior.promoted.sha,d,cwd))return {ok:false,code:'PREREQUISITE',reason:p};}const claim={agent,session:sess,host:hostname(),worktree_id:sha256(hostname()+cwd),seq:s.events.length+1};const x=transition(s,'claim',{...ctx,claim,baseline_sha:d,resume:has('--resume')});if(!x.ok)return x;return {task:id,baseline:d,slug:task.slug};});if(!result.ok)fail(result.code,result.reason);
    const workBranch=`work/${result.slug}`;const existing=await git(['branch','--list',workBranch],{cwd});if(!existing.trim())await git(['branch',workBranch,result.baseline],{cwd});emit({claimed:id,session:sess,branch:workBranch,switch_command:`git switch ${workBranch}`});return;
  }
  if(cmd==='freeze'){await freeze(cwd,id,agent,sess);return;}
  if(cmd==='review-start'){await reviewStart(cwd,id,agent,sess);return;}
  if(cmd==='review-result'){const input=arg('--result');if(!input)fail('RESULT_FILE','--result required',2);await reviewResult(cwd,id,agent,sess,input,{emitOnly:has('--emit-only')});return;}
  if(cmd==='ingest'){const file=id,r=JSON.parse(await readFile(file,'utf8'));if(!r.task||!r.reviewer||!r.session)fail('INGEST_FORMAT','task, reviewer and session required',2);await reviewResult(cwd,r.task,r.reviewer,r.session,file,{invoker:agentCtx(agent,sess).actor,ingested:true});return;}
  if(cmd==='promote'){await promoteCommand(cwd,id,agent);return;}
  if(['withdraw','reopen','block'].includes(cmd)){
    const op=cmd,reason=arg('--reason');if(cmd!=='withdraw'&&!reason)fail('REASON_REQUIRED','--reason required',2);if(cmd==='block'&&!BLOCK_REASONS.includes(reason))fail('BLOCK_REASON',`--reason must be one of ${BLOCK_REASONS.join(', ')}; put details in --note`,2);
    const result=await checkedTransition(cwd,op,{...ctx,reason,note:arg('--note')});emit({task:id,state:cmd.toUpperCase(),coord:result.tip});return;
  }
  fail('UNKNOWN_COMMAND',cmd||'(missing)',2);
}
try{await main();}catch(e){const code=e.code||'ERROR',exit=typeof e.exit==='number'?e.exit:1;process.stderr.write(json?canonicalJSON({ok:false,code,error:e.message})+'\n':`ERROR: ${code}: ${e.message}\n`);process.exitCode=exit;}
