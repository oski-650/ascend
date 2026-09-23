import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJSON, sha256, isSha40 } from '../lib/canon.mjs';
import { overlap, matches, validatePattern } from '../lib/paths.mjs';
import { guardPush } from '../lib/git.mjs';
import { nextFor, transition, event, fold, validateWhole } from '../lib/state.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

test('T02 overlap vectors and path grammar',()=>{
  const yes=[['apps/os/core/db/sales-reads.ts','apps/os/core/db/sales-reads.ts'],['apps/os/core/**','apps/os/core/db/sales-reads.ts'],['apps/os/core/','apps/os/core/db/x.ts'],['apps/os/tests/**/*.test.ts','apps/os/tests/db/sales-reads.test.ts'],['apps/os/*/x.ts','apps/os/core/*.ts'],['**','anything'],['a/*b','a/c*']];
  const no=[['apps/os/app/sales/**','apps/os/app/partner/**'],['apps/os/tests/**/sales*.ts','apps/os/tests/**/auth*.ts'],['a/*.css','a/*.ts']];
  for(const [a,b] of yes){assert.equal(overlap(a,b),true,`${a}/${b}`);assert.equal(overlap(b,a),true);}
  for(const [a,b] of no){assert.equal(overlap(a,b),false,`${a}/${b}`);assert.equal(overlap(b,a),false);}
  for(const p of ['/a','a//b','a/../b','a/?','a/[x]','a/**x','a\\b'])assert.equal(validatePattern(p),false,p);
  assert.equal(matches('a/**/x.ts','a/x.ts'),true);assert.equal(matches('a/**/x.ts','a/b/c/x.ts'),true);
  const pool=['a','b','*','a*','*b','**','a/**','b/**','*/a','**/b','a/*','*/b'];const values=['a','b','aa','ab','ba','bb'];const paths=[];
  for(const x of values){paths.push(x);for(const y of values){paths.push(`${x}/${y}`);for(const z of values)paths.push(`${x}/${y}/${z}`);}}
  let seed=17;for(let n=0;n<200;n++){seed=(seed*1664525+1013904223)>>>0;const a=pool[seed%pool.length];seed=(seed*1664525+1013904223)>>>0;const b=pool[seed%pool.length];const brute=paths.some(p=>matches(a,p)&&matches(b,p));assert.equal(overlap(a,b),brute,`${a}/${b}`);}
});
test('T23 push guard refuses destructive refs',()=>{
  const base='refs/heads/dev';
  for(const spec of ['--force','-f','--force-with-lease','--delete','--mirror','+abc:refs/heads/dev','abc:refs/heads/main',':refs/heads/dev','abc:refs/heads/evil'])assert.throws(()=>guardPush([spec],base));
  assert.doesNotThrow(()=>guardPush([`${'a'.repeat(40)}:refs/heads/review/test-r1`,`${'b'.repeat(40)}:refs/heads/agents/coord`],base));
  assert.throws(()=>guardPush([`${'a'.repeat(40)}:refs/heads/review/test-r1`],base,{'refs/heads/review/test-r1':'other'}));
  for(const name of readdirSync(join(import.meta.dirname,'../lib')).filter(x=>x.endsWith('.mjs'))){const source=readFileSync(join(import.meta.dirname,'../lib',name),'utf8');assert.doesNotMatch(source,/--force|--delete|\+refs/,name);}
});
test('T24 next priority and deterministic output',()=>{
  const tasks={};for(const [id,state,builder,reviewer,priority] of [['A','IMPLEMENTING','codex','claude',1],['B','PUBLISHED','claude','codex',9],['C','PUBLISHED','claude','codex',1]])tasks[id]={id,state,builder,reviewer,priority,round:1,write_paths:['a'],blocked_paths:[],open_findings:[],review:{sha:'a'.repeat(40)}};
  const s={tasks,events:[]};assert.equal(nextFor('codex',s).slice,'C');assert.equal(canonicalJSON(nextFor('codex',s)),canonicalJSON(nextFor('codex',s)));
});
test('T22 invalid transition matrix refuses unrelated commands',()=>{
  const matrix={AVAILABLE:['claim','block','abandon'],IMPLEMENTING:['claim','publish','block','release','abandon'],PUBLISHED:['withdraw','reviewStart','invalidate','block','release','abandon'],REVIEWING:['reviewStart','fix','accept','invalidate','block','release','abandon'],FIX_REQUIRED:['claim','publish','block','release','abandon'],ACCEPTED:['reopen','promote','invalidate','block','release','abandon'],PROMOTED:[],BLOCKED:['unblock','release','abandon'],ABANDONED:[]};
  const commands=['claim','publish','withdraw','reviewStart','fix','accept','reopen','promote','invalidate','block','unblock','release','abandon'];
  for(const [state,allowed] of Object.entries(matrix))for(const cmd of commands)if(!allowed.includes(cmd)){
    const s={tasks:{T:{id:'T',state,builder:'codex',reviewer:'claude'}},events:[]};assert.equal(transition(s,cmd,{id:'T',as:'codex'}).ok,false,`${state}/${cmd}`);
  }
  for(const [state,cmd,actor] of [['IMPLEMENTING','publish','claude'],['PUBLISHED','reviewStart','codex'],['REVIEWING','accept','codex'],['ACCEPTED','promote','claude']]){
    const s={tasks:{T:{id:'T',state,builder:'codex',reviewer:'claude'}},events:[]};assert.equal(transition(s,cmd,{id:'T',as:actor}).ok,false,`${state}/${cmd}/${actor}`);
  }
});
test('T07 full SHA and canonical JSON',()=>{assert.equal(isSha40('a'.repeat(40)),true);assert.equal(isSha40('a'.repeat(12)),false);assert.equal(canonicalJSON({z:1,a:{b:2,a:3}}),'{"a":{"a":3,"b":2},"z":1}');assert.equal(sha256('x').length,64);});
test('T12 whole-state validator reports unknown state, overlapping locks, and broken chain',()=>{
  const config={schema_version:1,baseline_ref:'refs/heads/dev',remote:'origin',agents:{codex:{kinds:['builder','reviewer']},claude:{kinds:['builder','reviewer']}},humans:['oscar'],forbidden_name_patterns:[],stale_after_hours:8,genesis:{baseline_sha:'a'.repeat(40),seq:1}};
  const base={id:'T1',slug:'t1',kind:'implement',title:'Test',priority:1,builder:'codex',reviewer:'claude',state:'IMPLEMENTING',baseline_sha:'a'.repeat(40),round:0,rounds:[],review:null,accepted_sha:null,accepted_tree:null,promoted:null,write_paths:['a.txt'],read_paths:[],blocked_paths:[],prerequisites:[],required_gates:[],promotion_gates:[],required_manual_checks:[],open_findings:[],read_first:[],promote_policy:'auto',promote_mode:'ff_only',claim:{agent:'codex',session:'one',host:'h',worktree_id:'w1',seq:1},blocked:null,legacy:false,updated_seq:0};
  const s={config,tasks:{},events:[]};event(s,'task.created',{actor:{kind:'human',id:'oscar',session:'human',host:'h'},from:null},base);const other={...base,id:'T2',slug:'t2',builder:'claude',reviewer:'codex',claim:{agent:'claude',session:'two',host:'h',worktree_id:'w2',seq:2}};event(s,'task.created',{actor:{kind:'human',id:'oscar',session:'human',host:'h'},from:null},other);
  assert.match(validateWhole(s).join(';'),/overlapping locks/);s.tasks.T2.state='MALFORMED';assert.match(validateWhole(s).join(';'),/state/);s.events[1].prev='f'.repeat(64);assert.match(validateWhole(s).join(';'),/event chain/);
});
test('T24 all next priorities select the first actionable class',()=>{
  const template={id:'A',priority:1,builder:'codex',reviewer:'claude',round:1,write_paths:['a.txt'],blocked_paths:[],open_findings:[],read_first:[],required_gates:[],required_manual_checks:[],review:{sha:'a'.repeat(40),tree:'b'.repeat(40),branch:'review/a-r1'}};
  const cases=[['REVIEWING','claude','REVIEW'],['PUBLISHED','claude','REVIEW'],['FIX_REQUIRED','codex','FIX'],['IMPLEMENTING','codex','IMPLEMENT'],['ACCEPTED','codex','PROMOTE'],['AVAILABLE','codex','CLAIM']];
  for(const [state,agent,expected] of cases){const t={...template,state,promote_policy:'auto',prerequisites:[],accepted_sha:'a'.repeat(40)};const s={tasks:{A:t},events:[]};assert.equal(nextFor(agent,s).task,expected,state);}
  assert.equal(nextFor('codex',{tasks:{},events:[]}).task,'WAIT');
});
