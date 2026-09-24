import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { canonicalJSON } from './canon.mjs';
import { validateWhole } from './state.mjs';
import { validateManifest, validateResult } from './schema.mjs';
import { git, revParse, lsRemote, isAncestor, showFile, createTree, commitTree, push, GitError, trim } from './git.mjs';

export class CoordError extends Error {constructor(code,message,exit=3){super(message);this.code=code;this.exit=exit;}}
const coordRef='refs/heads/agents/coord';
async function localPath(cwd,name){const p=trim(await git(['rev-parse','--git-path','ascend-agent'],{cwd}));return join(p.startsWith('/')?p:join(cwd,p),name);}
async function seen(cwd){try{return (await readFile(await localPath(cwd,'last_seen_coord'),'utf8')).trim();}catch{return null;}}
async function setSeen(cwd,sha){const p=await localPath(cwd,'last_seen_coord');await mkdir(dirname(p),{recursive:true});await writeFile(p,sha+'\n');}
async function file(tip,path,cwd){try{return await showFile(tip,path,cwd);}catch{return null;}}
async function checkLinearity(last,tip,cwd){
  if(last&&!await isAncestor(last,tip,cwd))throw new CoordError('COORD_REWRITTEN','coord ref no longer descends from last seen');
  const commits=trim(await git(['rev-list','--reverse',last?`${last}..${tip}`:tip],{cwd})).split('\n').filter(Boolean);
  let attested=[];try{const log=(await showFile(tip,'activity.jsonl',cwd)).toString().trim().split('\n').map(JSON.parse);attested=log.filter(e=>e.type==='coord.repair_attested').flatMap(e=>e.data.foreign_commits||[]);}catch{}
  let previous=last?Number(trim(await git(['show','-s','--format=%B',last],{cwd})).match(/Ascend-Coord-Seq: (\d+)/)?.[1]||0):0;
  for(const c of commits){const msg=await git(['show','-s','--format=%B',c],{cwd});const seq=Number(msg.match(/Ascend-Coord-Seq: (\d+)/)?.[1]);
    if(!seq||!msg.includes('Ascend-Coord-Op:')||!msg.includes('Ascend-Coord-Actor:')||!msg.includes('Ascend-Coord-Task:')){if(attested.includes(c))continue;throw new CoordError('COORD_FOREIGN_COMMIT',c);}
    if(seq!==previous+1)throw new CoordError('COORD_FOREIGN_COMMIT',c);
    previous=seq;
  }
}
export async function readTip(cwd){
  const remote=await lsRemote(coordRef,cwd);if(!remote)throw new CoordError('NOT_INITIALIZED','agents/coord does not exist',1);
  try{await git(['fetch','origin','+'+`${coordRef}:refs/remotes/origin/agents/coord`],{cwd});}
  catch(e){throw new CoordError('COORD_FETCH_FAILED',e.message,4);}
  const tip=await revParse('refs/remotes/origin/agents/coord',cwd);
  if(tip!==remote)throw new CoordError('COORD_MOVED_DURING_FETCH','retry',4);
  await checkLinearity(await seen(cwd),tip,cwd);return tip;
}
export async function loadState(tip,cwd){
  let config,events,files;
  try{
    const c=await file(tip,'coord.json',cwd),a=await file(tip,'activity.jsonl',cwd);
    if(!c||!a)throw new Error('missing coord.json or activity.jsonl');
    config=JSON.parse(c.toString());events=a.toString().trimEnd().split('\n').filter(Boolean).map(JSON.parse);
    if(c.toString()!==canonicalJSON(config,{pretty:true}))throw new Error('coord.json not canonical');
    files={};const names=trim(await git(['ls-tree','-r','--name-only',tip],{cwd})).split('\n').filter(Boolean);
    for(const name of names){if(!/^tasks\/.+\.json$/.test(name)&&!/^reviews\/.+\.json$/.test(name)&&name!=='coord.json'&&name!=='activity.jsonl')throw new Error(`unexpected coord path ${name}`);
      if(name==='coord.json'||name==='activity.jsonl')continue;
      const bytes=await file(tip,name,cwd),value=JSON.parse(bytes.toString());
      if(bytes.toString()!==canonicalJSON(value,{pretty:true}))throw new Error(`${name} not canonical`);
      files[name]=value;
    }
    const tasks=Object.fromEntries(Object.entries(files).filter(([k])=>k.startsWith('tasks/')).map(([k,v])=>[k.slice(6,-5),v]));
    const state={config,events,tasks,files,tip};
    const errors=validateWhole(state);for(const [name,v] of Object.entries(files)){if(name.startsWith('reviews/'))errors.push(...(name.endsWith('.result.json')?validateResult(v):validateManifest(v)).map(x=>`${name}: ${x}`));}
    if(errors.length)throw new Error(errors.join('; '));
    return state;
  }catch(e){throw new CoordError('COORD_INVALID',e.message);}
}
function stateFiles(s){const files={'coord.json':canonicalJSON(s.config,{pretty:true}),'activity.jsonl':s.events.map(e=>canonicalJSON(e)).join('\n')+'\n'};
  for(const [id,t] of Object.entries(s.tasks))files[`tasks/${id}.json`]=canonicalJSON(t,{pretty:true});
  for(const [name,v] of Object.entries(s.files))if(name.startsWith('reviews/'))files[name]=canonicalJSON(v,{pretty:true});return files;
}
function trailer(seq,op,actor,task){return `Ascend-Coord-Seq: ${seq}\nAscend-Coord-Op: ${op}\nAscend-Coord-Actor: ${actor}\nAscend-Coord-Task: ${task||'-'}`;}
export async function casMutate(cwd,op,actor,mutator,{extraRefspecs=[]}={}){
  for(let attempt=0;attempt<3;attempt++){
    const tip=await readTip(cwd),s=await loadState(tip,cwd),before=stateFiles(s),oldLog=before['activity.jsonl'];
    const result=await mutator(s,tip);
    if(result?.ok===false)return result;
    const errors=validateWhole(s);if(errors.length)throw new CoordError('SELF_INVALID',errors.join('; '));
    const after=stateFiles(s);
    if(!after['activity.jsonl'].startsWith(oldLog))throw new CoordError('LOG_REWRITE','activity log is not append-only');
    for(const name of Object.keys(before))if(name.startsWith('reviews/')&&before[name]!==after[name])throw new CoordError('REVIEW_REWRITE',name);
    const changed=Object.fromEntries(Object.entries(after).filter(([k,v])=>before[k]!==v));
    if(!Object.keys(changed).length){await setSeen(cwd,tip);return {ok:true,tip,noop:true,...result};}
    const tree=await createTree(tip,changed,cwd),seq=s.events.length;
    const c=await commitTree(tree,[tip],`Ascend coord ${op}\n\n${trailer(seq,op,actor,result?.task)}`,cwd);
    const refs=result?.refspecs||extraRefspecs;
    if(refs.length&&process.env.NODE_ENV==='test'&&process.env.ASCEND_AGENT_TEST_FAULT==='after_review_ref'){
      for(const ref of refs){const [sha,dest]=ref.split(':');const existing=await lsRemote(dest,cwd);if(!existing)await push([ref],s.config.baseline_ref,cwd);else if(existing!==sha)throw new CoordError('BRANCH_COLLISION',dest,1);}
      throw new CoordError('FAULT_AFTER_REVIEW_REF','test interrupted before coord push',5);
    }
    try{
      await push([...refs,`${c}:${coordRef}`],s.config.baseline_ref,cwd,{atomic:refs.length>0});
      if(process.env.NODE_ENV==='test'&&process.env.ASCEND_AGENT_TEST_FAULT==='after_coord_push')throw new CoordError('OUTCOME_UNKNOWN','test interrupted after successful coord push',5);
      await setSeen(cwd,c);return {ok:true,tip:c,...result};
    }catch(e){
      if(e instanceof CoordError&&e.code==='OUTCOME_UNKNOWN'&&process.env.NODE_ENV==='test')throw e;
      if(e instanceof GitError&&e.code===1)throw new CoordError('BRANCH_COLLISION',e.message,1);
      for(const ref of refs){const [sha,dest]=ref.split(':');if(dest.startsWith('refs/heads/review/')){const remote=await lsRemote(dest,cwd).catch(()=>null);if(remote&&remote!==sha)throw new CoordError('BRANCH_COLLISION',dest,1);}}
      const message=e.message||'';
      if(refs.length&&/atomic.*(not supported|does not support)/i.test(message)){
        try{for(const x of refs){const dest=x.split(':')[1],existing=await lsRemote(dest,cwd);if(existing&&existing!==x.split(':')[0])throw new CoordError('BRANCH_COLLISION',dest,1);if(!existing)await push([x],s.config.baseline_ref,cwd);}await push([`${c}:${coordRef}`],s.config.baseline_ref,cwd);await setSeen(cwd,c);return {ok:true,tip:c,...result};}
        catch(f){if(f instanceof CoordError)throw f;}
      }
      const remote=await lsRemote(coordRef,cwd).catch(()=>null);
      if(remote===c){await setSeen(cwd,c);return {ok:true,tip:c,recovered:true,...result};}
      if(remote===tip)throw new CoordError('PUSH_FAILED',message,4);
      if(remote){await git(['fetch','origin',`${coordRef}:refs/remotes/origin/agents/coord`],{cwd}).catch(()=>{});if(await isAncestor(tip,remote,cwd).catch(()=>false))continue;}
      throw new CoordError('OUTCOME_UNKNOWN',message,5);
    }
  }
  throw new CoordError('CONTENTION','coord changed on three attempts',4);
}
export async function initCoord(cwd,config,actor){
  if(await lsRemote(coordRef,cwd))throw new CoordError('ALREADY_INITIALIZED','agents/coord exists',1);
  const e={seq:1,prev:'0'.repeat(64),ts:new Date().toISOString(),type:'coord.initialized',actor,task:null,from:null,to:null,witnessed:true,override:true,data:{baseline_sha:config.genesis.baseline_sha}};
  const tree=await createTree(null,{'coord.json':canonicalJSON(config,{pretty:true}),'activity.jsonl':canonicalJSON(e)+'\n'},cwd);
  const c=await commitTree(tree,[],`Ascend coord genesis\n\n${trailer(1,'init',actor.id,'-')}`,cwd);
  await push([`${c}:${coordRef}`],config.baseline_ref,cwd);await setSeen(cwd,c);return c;
}
export async function attestRepair(cwd,actor,reason){
  const remote=await lsRemote(coordRef,cwd);if(!remote)throw new CoordError('NOT_INITIALIZED','agents/coord missing',1);
  await git(['fetch','origin',`${coordRef}:refs/remotes/origin/agents/coord`],{cwd});
  const last=await seen(cwd);if(last&&!await isAncestor(last,remote,cwd))throw new CoordError('COORD_REWRITTEN','cannot attest a rewrite');
  const commits=trim(await git(['rev-list','--reverse',last?`${last}..${remote}`:remote],{cwd})).split('\n').filter(Boolean);
  const foreign=[];for(const c of commits){const msg=await git(['show','-s','--format=%B',c],{cwd});if(!msg.includes('Ascend-Coord-Seq:')||!msg.includes('Ascend-Coord-Op:'))foreign.push(c);}
  if(!foreign.length)throw new CoordError('NO_FOREIGN_COMMITS','nothing to attest',1);
  const s=await loadState(remote,cwd);const before={'activity.jsonl':s.events.map(e=>canonicalJSON(e)).join('\n')+'\n'};
  const { event }=await import('./state.mjs');event(s,'coord.repair_attested',{actor,override:true},null,{foreign_commits:foreign,reason});
  const tree=await createTree(remote,{'activity.jsonl':s.events.map(e=>canonicalJSON(e)).join('\n')+'\n'},cwd),seq=s.events.length;
  const c=await commitTree(tree,[remote],`Ascend coord attest-repair\n\n${trailer(seq,'attest-repair',actor.id,'-')}`,cwd);
  await push([`${c}:${coordRef}`],s.config.baseline_ref,cwd);await setSeen(cwd,c);return {sha:c,foreign};
}
