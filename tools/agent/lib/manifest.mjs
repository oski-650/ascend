import { canonicalJSON, sha256 } from './canon.mjs';
import { diffRaw } from './git.mjs';
export const buildChanges=diffRaw;
export const changesSha=changes=>sha256(canonicalJSON(changes));
export async function deltaFromPrevious(previous,sha,cwd){return previous?diffRaw(previous,sha,cwd):[];}
