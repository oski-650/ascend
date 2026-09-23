import { canonicalJSON, sha256 } from './canon.mjs';
import { diffRaw, lsTree, mergeTreeWriteTree, commitTree } from './git.mjs';
import { anyOverlap, matches } from './paths.mjs';
export async function expectedOverlayTree(base,accepted,baseline,cwd){
  const f=await diffRaw(base,accepted,cwd),expected=await lsTree(baseline,cwd),a=await lsTree(accepted,cwd);
  for(const {path} of f){if(a.has(path))expected.set(path,a.get(path));else expected.delete(path);}return expected;
}
const list=m=>[...m].sort(([a],[b])=>a.localeCompare(b)).map(([path,x])=>`${x.mode} ${x.type} ${x.blob}\t${path}\0`).join('');
export async function treeProof(base,accepted,baseline,merged,cwd){
  const expected=await expectedOverlayTree(base,accepted,baseline,cwd),actual=await lsTree(merged,cwd);
  if(list(expected)!==list(actual))throw new Error('OVERLAY_TREE_MISMATCH');return sha256(list(expected));
}
export async function ffOrOverlay(task,baseline,cwd){
  const b=task.rounds.at(-1).baseline,a=task.accepted_sha;
  const {isAncestor}=await import('./git.mjs');
  if(await isAncestor(baseline,a,cwd))return {mode:'ff',sha:a,baseline_before:baseline};
  if(!await isAncestor(b,baseline,cwd))return {mode:'blocked',reason:'BASELINE_REWRITTEN'};
  const f=(await diffRaw(b,a,cwd)).map(x=>x.path),g=(await diffRaw(b,baseline,cwd)).map(x=>x.path);
  if(task.promote_mode!=='overlay_allowed'||f.some(p=>g.includes(p))||g.some(p=>task.read_paths.some(q=>matches(q,p))))return {mode:'rebase',reason:'SYS-REBASE'};
  const tree=await mergeTreeWriteTree(baseline,a,cwd),proof=await treeProof(b,a,baseline,tree,cwd);
  const sha=await commitTree(tree,[baseline,a],`Ascend overlay ${task.id}`,cwd);
  return {mode:'overlay',sha,baseline_before:baseline,tree_proof_sha256:proof};
}
