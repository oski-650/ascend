import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { sha256 } from './canon.mjs';
import { revParse, statusPaths, treeOf, gitPath, showFile } from './git.mjs';
const exec=promisify(execFile);
export class GateError extends Error{constructor(message,exit=7){super(message);this.exit=exit;}}
export function safeGateSummary(name,exit_code){
  return `${name.replace(/[^a-zA-Z0-9:-]/g,'_')}: ${exit_code===0?'passed':'failed'} (exit ${exit_code})\n`;
}
export function gateCommandForFreeze(name,gate){
  const phase={'gate:static':'static','gate:server':'server'}[name];
  if(!phase)return gate.cmd;
  if(gate.cwd!=='apps/os'||JSON.stringify(gate.cmd)!==JSON.stringify(['npm','run',name]))
    throw new GateError(`baseline ${name} command is not the expected proof gate`,3);
  // Prove executes selected phases. Freeze verifies their receipts for this exact tree;
  // the direct npm gate commands retain their full execution/aggregate semantics.
  return [process.execPath,'scripts/gate-proof.mjs','verify-phase',phase];
}
export async function loadGateRegistry(cwd,baselineSha){
  const path='tools/agent/gates.json';
  try{
    const bytes=await showFile(baselineSha,path,cwd);
    const entries=JSON.parse(bytes.toString());
    if(!entries||typeof entries!=='object'||Array.isArray(entries))throw new Error('gate registry is not an object');
    const blobSha=await revParse(`${baselineSha}:${path}`,cwd);
    return {entries,blobSha,baselineSha};
  }catch(e){throw new GateError(`baseline gate registry invalid: ${e.message}`,3);}
}
export async function runGates(names,{sha,cwd,registry}={}){
  if(!registry?.entries||!registry.blobSha)throw new GateError('baseline gate registry is required',3);
  const evidence=[];
  for(const name of names){const gate=registry.entries[name];if(!gate||!Array.isArray(gate.cmd)||!gate.cmd.length||!Number.isInteger(gate.timeout_s))throw new GateError(`unknown gate ${name}`,1);
    if(await revParse('HEAD',cwd)!==sha||(await statusPaths(cwd)).length)throw new GateError(`GATE_DIRTIED_TREE before ${name}`,1);
    const started=Date.now(), working=resolve(cwd,gate.cwd),command=gateCommandForFreeze(name,gate);let exit_code=0;
    try{await exec(command[0],command.slice(1),{cwd:working,timeout:gate.timeout_s*1000,maxBuffer:32*1024*1024});}
    catch(e){exit_code=typeof e.code==='number'?e.code:1;}
    // Gate output can contain URLs, passwords, or private backup content. Evidence records only
    // this fixed summary; raw child output never enters local logs or published manifests.
    const output=safeGateSummary(name,exit_code);
    const dir=await gitPath(cwd,'ascend-agent/logs');await mkdir(dir,{recursive:true});await writeFile(join(dir,`${sha}-${name.replace(/[^a-zA-Z0-9]/g,'_')}.log`),output);
    if(await revParse('HEAD',cwd)!==sha||(await statusPaths(cwd)).length)throw new GateError(`GATE_DIRTIED_TREE after ${name}`,1);
    const item={name,command,cwd:gate.cwd,registry_blob_sha:registry.blobSha,exit_code,duration_ms:Date.now()-started,log_sha256:sha256(output),log_tail:Buffer.from(output).subarray(-4096).toString(),ran_on:{sha,tree:await treeOf(sha,cwd),clean_before:true,clean_after:true}};
    evidence.push(item);if(exit_code)throw new GateError(`${name} exited ${exit_code}: ${item.log_tail}`);
  }
  return evidence;
}
