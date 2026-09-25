import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { sha256 } from './canon.mjs';
import { revParse, statusPaths } from './git.mjs';

const exec = promisify(execFile);
const allowed = /^(candidate: [a-f0-9]{40} tree [a-f0-9]{40}|(?:static|server|db|recovery fixture|R1b|R1c): [0-9]+ exact-tree (?:receipts already valid|suites proven)|residue: read-only on; applogin organizations 0; users 0; scratch schemas 0|aggregate: [0-9]+ PROVEN suites; READY TO FREEZE tree [a-f0-9]{40}|selected proof: valid for tree [a-f0-9]{40}|OWNER_CHECKPOINT: run `env -u ASCEND_AGENT npm run agent -- prove [A-Za-z0-9][A-Za-z0-9._-]{0,79} --owner` in the owner terminal)$/;

export function safeProofLines(output) {
  const lines = output.trim().split('\n').filter(Boolean);
  if (lines.some(line => !allowed.test(line))) throw Error('proof output failed allowlist');
  if (!lines[0]?.startsWith('candidate: ') ||
    !lines.at(-1)?.startsWith('aggregate: ') && !lines.at(-1)?.startsWith('selected proof: ') &&
    !lines.at(-1)?.startsWith('OWNER_CHECKPOINT: '))
    throw Error('proof progress is incomplete');
  return lines;
}

export async function proveTask({ cwd, task, id, owner, actor }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(id) || task.id !== id) throw Error('proof task mismatch');
  if (!['IMPLEMENTING', 'FIX_REQUIRED'].includes(task.state) ||
    task.claim?.agent !== task.builder || task.claim.worktree_id !== sha256(hostname() + cwd))
    throw Error('proof task is not claimed in this worktree');
  if (owner ? actor !== 'owner' : actor !== task.builder) throw Error('proof actor invalid');
  if ((await statusPaths(cwd)).length) throw Error('proof candidate must be clean');
  const head = await revParse('HEAD', cwd);
  let output;
  try {
    const result = await exec(process.execPath,
      [join(cwd, 'apps/os/scripts/proof-orchestrator.mjs'), '--task-id', id,
        ...task.required_gates.flatMap(name => ['--gate', name]), ...(owner ? ['--owner'] : [])],
      { cwd: join(cwd, 'apps/os'), maxBuffer: 2 * 1024 * 1024, timeout: 60 * 60 * 1000 });
    output = result.stdout;
  } catch { throw Error('proof orchestration failed; private child output withheld'); }
  if (await revParse('HEAD', cwd) !== head || (await statusPaths(cwd)).length)
    throw Error('proof candidate changed during execution');
  return safeProofLines(output);
}
