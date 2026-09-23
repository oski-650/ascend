import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isSha40 } from './canon.mjs';
const runFile=promisify(execFile);
let faultConsumed=false;

export class GitError extends Error { constructor(message,code=4){super(message);this.code=code;} }
export async function git(args,{cwd,env,encoding='utf8',timeout=120000}={}) {
  try {const r=await runFile('git',args,{cwd,env,encoding,maxBuffer:64*1024*1024,timeout});return r.stdout;}
  catch(e){throw new GitError((e.stderr||e.message).toString().trim(),4);}
}
export const trim = s => s.toString().trim();
export async function gitPath(cwd,path){return resolve(cwd,trim(await git(['rev-parse','--git-path',path],{cwd})));}
export async function revParse(ref,cwd){return trim(await git(['rev-parse','--verify',ref],{cwd}));}
export async function isAncestor(a,b,cwd){try{await git(['merge-base','--is-ancestor',a,b],{cwd});return true;}catch{return false;}}
export async function fetch(ref,cwd){return git(['fetch','origin',ref],{cwd});}
export async function lsRemote(ref,cwd){const s=trim(await git(['ls-remote','origin',ref],{cwd}));return s?s.split(/\s/)[0]:null;}
export async function objectType(sha,cwd){return trim(await git(['cat-file','-t',sha],{cwd}));}
export async function treeOf(sha,cwd){return revParse(`${sha}^{tree}`,cwd);}
export async function showFile(sha,path,cwd){return git(['show',`${sha}:${path}`],{cwd,encoding:'buffer'});}
export async function diffNames(a,b,cwd){const z=await git(['diff','--name-only','-z','--no-renames',a,b],{cwd,encoding:'buffer'});return z.toString().split('\0').filter(Boolean);}
export async function statusPaths(cwd){
  const z=(await git(['status','--porcelain=v1','-z','--untracked-files=all'],{cwd,encoding:'buffer'})).toString().split('\0').filter(Boolean);
  const paths=[];for(let i=0;i<z.length;i++){const entry=z[i];paths.push(entry.slice(3));if(entry[0]==='R'||entry[1]==='R'||entry[0]==='C'||entry[1]==='C')paths.push(z[++i]);}return paths;
}
export async function lsTree(sha,cwd){
  const raw=await git(['ls-tree','-r','-z',sha],{cwd,encoding:'buffer'}), out=new Map();
  for(const x of raw.toString().split('\0').filter(Boolean)){const tab=x.indexOf('\t'),head=x.slice(0,tab),path=x.slice(tab+1);const [mode,type,blob]=head.split(' ');out.set(path,{mode,type,blob});}return out;
}
export async function diffRaw(a,b,cwd){
  const old=await lsTree(a,cwd), now=await lsTree(b,cwd), paths=[...new Set([...old.keys(),...now.keys()])].sort();
  return paths.filter(p=>JSON.stringify(old.get(p))!==JSON.stringify(now.get(p))).map(path=>({status:!old.has(path)?'A':!now.has(path)?'D':'M',path,old_blob:old.get(path)?.blob||null,new_blob:now.get(path)?.blob||null,old_mode:old.get(path)?.mode||null,new_mode:now.get(path)?.mode||null}));
}
export function guardPush(args,baseline,existing={}){
  if(args.some(a=>a.startsWith('-')||a.startsWith('+')))throw new GitError('forbidden push option',1);
  for(const a of args){if(!a.includes(':'))throw new GitError(`invalid push refspec ${a}`,1);const [src,dst]=a.split(':');
    if(!isSha40(src)||!dst||![baseline,'refs/heads/agents/coord'].includes(dst)&&!/^refs\/heads\/review\/[a-z0-9-]+-r[1-9][0-9]*$/.test(dst))throw new GitError(`forbidden push destination ${dst}`,1);
    if(dst.startsWith('refs/heads/review/')&&existing[dst]&&existing[dst]!==src)throw new GitError('BRANCH_COLLISION',1);
  }
}
export async function push(refspecs,baseline,cwd,{atomic=false}={}){
  guardPush(refspecs,baseline);
  for(const spec of refspecs){const [src,dst]=spec.split(':');if(dst.startsWith('refs/heads/review/')){const remote=await lsRemote(dst,cwd);if(remote&&remote!==src)throw new GitError('BRANCH_COLLISION',1);}}
  if(!faultConsumed&&process.env.NODE_ENV==='test'&&process.env.ASCEND_AGENT_TEST_FAULT==='baseline_move_once'&&refspecs.some(x=>x.endsWith(`:${baseline}`))){
    faultConsumed=true;const competitor=process.env.ASCEND_AGENT_TEST_COMPETITOR;
    if(!isSha40(competitor))throw new GitError('invalid test competitor',1);
    await git(['push','origin',`${competitor}:${baseline}`],{cwd});
  }
  return git(['push',...(atomic?['--atomic']:[]),'origin',...refspecs],{cwd});
}
export async function commitTree(tree,parents,message,cwd){return trim(await git(['commit-tree',tree,...parents.flatMap(p=>['-p',p]),'-m',message],{cwd}));}
export async function createTree(base,files,cwd){
  const dir=await mkdtemp(join(tmpdir(),'ascend-index-')), index=join(dir,'index');
  try{
    // Inherit the normal execution environment and isolate only Git's index.
    const env={...process.env,GIT_INDEX_FILE:index};
    await git(base?['read-tree',base]:['read-tree','--empty'],{cwd,env});
    for(const [path,bytes] of Object.entries(files)){
      if(bytes===null){await git(['update-index','--for'+'ce-remove','--',path],{cwd,env});continue;}
      const file=join(dir,'blob');await writeFile(file,bytes);
      const blob=trim(await git(['hash-object','-w',file],{cwd,env}));
      await git(['update-index','--add','--cacheinfo','100644',blob,path],{cwd,env});
    }
    return trim(await git(['write-tree'],{cwd,env}));
  }finally{await rm(dir,{recursive:true,force:true});}
}
export async function mergeTreeWriteTree(d,a,cwd){return trim(await git(['merge-tree','--write-tree',d,a],{cwd}));}
export async function worktreeAdd(path,sha,cwd){return git(['worktree','add','--detach',path,sha],{cwd});}
