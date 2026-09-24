import { canonicalJSON, sha256 } from './canon.mjs';
import { validateTask, validateCoord, validateEvent, LOCKED } from './schema.mjs';
import { anyOverlap } from './paths.mjs';

export function fold(events) {
  const tasks={};
  for (const e of events) {
    if (e.task && e.data?.snapshot) tasks[e.task]=e.data.snapshot;
  }
  return tasks;
}
export function validateWhole(s) {
  const errors=validateCoord(s.config);
  for (const [id,t] of Object.entries(s.tasks)) {
    errors.push(...validateTask(t,s.config).map(x=>`${id}: ${x}`));
    if (id !== t.id) errors.push(`${id}: file id mismatch`);
    for (const p of t.prerequisites || []) if (!s.tasks[p]) errors.push(`${id}: missing prerequisite ${p}`);
  }
  const ts=Object.values(s.tasks), slugs=new Set();
  for (const t of ts) { if (slugs.has(t.slug)) errors.push(`duplicate slug ${t.slug}`); slugs.add(t.slug); }
  for (let i=0;i<ts.length;i++) for(let j=i+1;j<ts.length;j++) {
    if (LOCKED.has(ts[i].state) && LOCKED.has(ts[j].state) && anyOverlap(ts[i].write_paths,ts[j].write_paths)) errors.push(`overlapping locks ${ts[i].id}/${ts[j].id}`);
    if (LOCKED.has(ts[i].state) && LOCKED.has(ts[j].state) && ts[i].claim?.worktree_id && ts[i].claim.worktree_id === ts[j].claim?.worktree_id) errors.push(`shared worktree ${ts[i].id}/${ts[j].id}`);
  }
  if (canonicalJSON(fold(s.events)) !== canonicalJSON(s.tasks)) errors.push('tasks differ from event replay');
  let prev='0'.repeat(64);
  for (let i=0;i<s.events.length;i++) {
    const e=s.events[i];
    errors.push(...validateEvent(e).map(x=>`event ${i+1}: ${x}`));
    if (e.seq!==i+1 || e.prev!==prev) errors.push(`event chain ${i+1}`);
    prev=sha256(canonicalJSON(e));
  }
  return errors;
}
export function event(s, type, ctx, task, data={}) {
  const seq=s.events.length+1;
  const prev=seq===1?'0'.repeat(64):sha256(canonicalJSON(s.events.at(-1)));
  const e={seq,prev,ts:new Date().toISOString(),type,actor:ctx.actor,task:task?.id,from:ctx.from??null,to:task?.state??null,witnessed:type!=='task.imported',override:!!ctx.override,data:{...data,...(task?{snapshot:{...task,updated_seq:seq}}:{})}};
  if (task) {task.updated_seq=seq;e.data.snapshot={...task};s.tasks[task.id]=task;}
  s.events.push(e);return e;
}
export function transition(s, cmd, ctx) {
  const t=s.tasks[ctx.id]; const refuse=(code,reason)=>({ok:false,code,reason});
  if (cmd==='task-add' || cmd==='import') {
    if (s.tasks[ctx.task.id]) return refuse('TASK_EXISTS',ctx.task.id);
    const n={...ctx.task,updated_seq:s.events.length+1};
    const e=validateTask(n,s.config); if(e.length)return refuse('INVALID_TASK',e.join(', '));
    if(Object.values(s.tasks).some(x=>x.slug===n.slug))return refuse('SLUG_COLLISION',n.slug);
    event(s,cmd==='import'?'task.imported':'task.created',ctx,n);return {ok:true,state:s};
  }
  if(!t)return refuse('NO_TASK',ctx.id);
  if(cmd==='claim') {
    if(ctx.resume) {
      if(!['IMPLEMENTING','FIX_REQUIRED'].includes(t.state)||t.builder!==ctx.as||t.claim?.agent!==ctx.as)return refuse('CANNOT_RESUME',t.state);
      const old=t.claim;t.claim=ctx.claim;event(s,'task.claim_resumed',{...ctx,from:t.state},t,{old_claim:old});return {ok:true,state:s};
    }
    if(t.state!=='AVAILABLE')return refuse('ALREADY_CLAIMED',t.state);
    if(t.builder!==ctx.as)return refuse('WRONG_BUILDER',ctx.as);
    if(t.prerequisites.some(id=>s.tasks[id]?.state!=='PROMOTED'))return refuse('PREREQUISITE',t.prerequisites);
    for(const other of Object.values(s.tasks)) if(other.id!==t.id&&LOCKED.has(other.state)) {
      if(anyOverlap(t.write_paths,other.write_paths))return refuse('PATH_CONFLICT',other.id);
      if(other.claim?.worktree_id===ctx.claim.worktree_id)return refuse('WORKTREE_BUSY',other.id);
    }
    if(Object.values(s.tasks).some(x=>x.id!==t.id&&x.builder===ctx.as&&['IMPLEMENTING','FIX_REQUIRED'].includes(x.state)))return refuse('AGENT_BUSY',ctx.as);
    t.state='IMPLEMENTING';t.claim=ctx.claim;t.baseline_sha=ctx.baseline_sha;event(s,'task.claimed',{...ctx,from:'AVAILABLE'},t);return {ok:true,state:s};
  }
  const allowed={publish:['IMPLEMENTING','FIX_REQUIRED'],withdraw:['PUBLISHED'],reviewStart:['PUBLISHED','REVIEWING'],fix:['REVIEWING'],accept:['REVIEWING'],reopen:['ACCEPTED'],promote:['ACCEPTED'],invalidate:['PUBLISHED','REVIEWING','ACCEPTED'],block:['AVAILABLE','IMPLEMENTING','PUBLISHED','REVIEWING','FIX_REQUIRED','ACCEPTED'],unblock:['BLOCKED'],release:[...LOCKED],abandon:['AVAILABLE',...LOCKED]};
  if(!allowed[cmd]?.includes(t.state))return refuse('INVALID_TRANSITION',`${cmd} from ${t.state}`);
  const from=t.state;
  if(['publish','withdraw','reopen','promote'].includes(cmd)&&ctx.as!==t.builder&&!ctx.human)return refuse('WRONG_BUILDER',ctx.as);
  if(['reviewStart','fix','accept'].includes(cmd)&&ctx.as!==t.reviewer)return refuse('WRONG_REVIEWER',ctx.as);
  const types={publish:'review.published',withdraw:'review.withdrawn',reviewStart:from==='REVIEWING'?'review.resumed':'review.started',fix:'review.fix_required',accept:'review.accepted',reopen:'acceptance.voided',promote:'task.promoted',invalidate:'review.invalidated',block:'task.blocked',unblock:'task.unblocked',release:'lock.released',abandon:'task.abandoned'};
  if(cmd==='publish') {t.round=ctx.manifest.round;t.rounds.push({n:t.round,branch:ctx.manifest.branch,sha:ctx.manifest.sha,tree:ctx.manifest.tree,baseline:ctx.manifest.baseline,status:'published'});t.review={round:t.round,branch:ctx.manifest.branch,sha:ctx.manifest.sha,tree:ctx.manifest.tree,reviewer_session:null};t.state='PUBLISHED';t.baseline_sha=ctx.manifest.baseline;}
  if(cmd==='withdraw') {t.rounds.at(-1).status='withdrawn';t.review=null;t.state='IMPLEMENTING';}
  if(cmd==='reviewStart') {t.review.reviewer_session=ctx.session;t.state='REVIEWING';}
  if(cmd==='fix') {t.rounds.at(-1).status='fix_required';const stillOpen=t.open_findings.filter(f=>ctx.result.prior_findings.some(x=>x.id===f.id&&x.disposition==='still_open'));t.open_findings=[...stillOpen,...ctx.result.findings.filter(f=>f.blocking&&!stillOpen.some(x=>x.id===f.id))];t.state=ctx.result.findings.some(f=>f.requires_scope_change)?'BLOCKED':'FIX_REQUIRED';if(t.state==='BLOCKED')t.blocked={from:'FIX_REQUIRED',reason:'SCOPE_CHANGE_REQUIRED',note:'review finding requires scope change',seq:s.events.length+1};}
  if(cmd==='accept') {t.rounds.at(-1).status='accepted';t.open_findings=[];t.accepted_sha=t.review.sha;t.accepted_tree=t.review.tree;t.state='ACCEPTED';}
  if(cmd==='reopen') {t.accepted_sha=null;t.accepted_tree=null;t.open_findings=[{id:ctx.reason==='SYS-REBASE'?'SYS-REBASE':'SYS-REOPEN',blocking:true,observed:ctx.reason}];t.state='FIX_REQUIRED';}
  if(cmd==='promote') {t.promoted=ctx.promoted;t.state='PROMOTED';}
  if(cmd==='invalidate'||cmd==='block') {t.blocked={from,reason:ctx.reason||'REVIEW_OBJECT_MOVED',note:ctx.note||'',seq:s.events.length+1};t.state='BLOCKED';if(cmd==='invalidate'&&t.rounds.length)t.rounds.at(-1).status='invalidated';}
  if(cmd==='unblock') {t.state=t.blocked.from;t.blocked=null;}
  if(cmd==='release') {if(t.rounds.length)t.rounds.at(-1).status='released';t.claim=null;t.review=null;t.state='AVAILABLE';}
  if(cmd==='abandon') t.state='ABANDONED';
  event(s,types[cmd],{...ctx,from,override:!!ctx.human},t,{...(ctx.reason?{reason:ctx.reason}:{}),...(ctx.eventData||{})});
  return {ok:true,state:s};
}
export function nextFor(agent,s) {
  const ordered=Object.values(s.tasks).sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id));
  const pick=(state,role)=>ordered.find(t=>t.state===state&&t[role]===agent);
  for(const [state,role,kind] of [['REVIEWING','reviewer','REVIEW'],['PUBLISHED','reviewer','REVIEW'],['FIX_REQUIRED','builder','FIX'],['IMPLEMENTING','builder','IMPLEMENT'],['ACCEPTED','builder','PROMOTE']]) {
    const t=pick(state,role); if(t && (state!=='ACCEPTED'||t.promote_policy==='auto'||s.events.some(e=>e.type==='promote.approved'&&e.task===t.id&&e.data.sha===t.accepted_sha))){
      const manifest=t.review?s.files?.[`reviews/${t.id}/r${t.round}.json`]:null;
      return {task:kind,slice:t.id,round:t.round,branch:t.review?.branch||null,sha:t.review?.sha||t.accepted_sha||null,tree:t.review?.tree||t.accepted_tree||null,baseline:manifest?.baseline||t.baseline_sha,mode:kind==='REVIEW'?'READ_ONLY':kind==='PROMOTE'?'PROMOTE':'WRITE',allowed_paths:kind==='FIX'||kind==='IMPLEMENT'?t.write_paths:[],blocked_paths:kind==='FIX'||kind==='IMPLEMENT'?t.blocked_paths:[],findings:t.open_findings||[],changed_files:manifest?.changes.length||0,delta_from_previous:manifest?.delta_from_previous.length||0,manual_checks:(t.required_manual_checks||[]).map(x=>x.id),read_first:t.read_first||[],gates:t.required_gates||[],command:kind==='REVIEW'?`npm run agent -- review-start ${t.id} --as ${agent}`:kind==='PROMOTE'?`npm run agent -- promote ${t.id} --as ${agent}`:kind==='FIX'||kind==='IMPLEMENT'?`npm run agent -- freeze ${t.id} --as ${agent}`:null};
    }
  }
  for(const t of ordered) if(t.state==='AVAILABLE'&&t.builder===agent&&t.prerequisites.every(id=>s.tasks[id]?.state==='PROMOTED')&&!Object.values(s.tasks).some(x=>x.id!==t.id&&LOCKED.has(x.state)&&anyOverlap(t.write_paths,x.write_paths)))return {task:'CLAIM',slice:t.id,mode:'WRITE',allowed_paths:t.write_paths,blocked_paths:t.blocked_paths,read_first:t.read_first,command:`npm run agent -- claim ${t.id} --as ${agent}`};
  return {task:'WAIT',waiting_on:ordered.filter(t=>t.builder===agent||t.reviewer===agent).map(t=>`${t.id} ${t.state}`),available_read_only_work:ordered.filter(t=>t.builder===agent&&t.state==='AVAILABLE').map(t=>t.id)};
}
