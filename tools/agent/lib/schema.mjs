import { isSha40 } from './canon.mjs';
import { validatePattern, validatePath, anyOverlap } from './paths.mjs';

export const STATES = ['AVAILABLE','IMPLEMENTING','PUBLISHED','REVIEWING','FIX_REQUIRED','ACCEPTED','PROMOTED','BLOCKED','ABANDONED'];
export const LOCKED = new Set(['IMPLEMENTING','PUBLISHED','REVIEWING','FIX_REQUIRED','ACCEPTED','BLOCKED']);
export const BLOCK_REASONS = ['SCOPE_CHANGE_REQUIRED','REVIEW_OBJECT_MOVED','BASELINE_REWRITTEN','NEEDS_DECISION','EXTERNAL_DEPENDENCY'];
const array = v => Array.isArray(v);
const strings = v => array(v) && v.every(x => typeof x === 'string');
export function validateCoord(c) {
  const e = [];
  if (!c || c.schema_version !== 1) e.push('schema_version');
  if (!/^refs\/heads\/(?!main$)[a-zA-Z0-9/._-]+$/.test(c?.baseline_ref || '')) e.push('baseline_ref');
  if (c?.remote !== 'origin') e.push('remote');
  if (!c?.agents || !c.agents.codex || !c.agents.claude) e.push('agents');
  if (!strings(c?.humans) || !c.humans.length) e.push('humans');
  if (!strings(c?.forbidden_name_patterns)) e.push('forbidden_name_patterns');
  if (!Number.isSafeInteger(c?.stale_after_hours) || c.stale_after_hours < 1) e.push('stale_after_hours');
  if (!isSha40(c?.genesis?.baseline_sha) || c.genesis.seq !== 1) e.push('genesis');
  return e;
}
export const slugOf = id => id.toLowerCase().replace(/[^a-z0-9]/g, '');
export function validateTask(t, config) {
  const e = [];
  if (!t || !/^[0-9A-Z][0-9A-Za-z.\-]{0,31}$/.test(t.id || '')) return ['id'];
  if (t.slug !== slugOf(t.id) || !t.slug) e.push('slug');
  if (!['implement','preflight','docs'].includes(t.kind)) e.push('kind');
  if (typeof t.title !== 'string' || !t.title) e.push('title');
  if (!Number.isSafeInteger(t.priority)) e.push('priority');
  if (!config.agents[t.builder] || !config.agents[t.reviewer] || t.builder === t.reviewer) e.push('roles');
  if (!STATES.includes(t.state)) e.push('state');
  for (const key of ['write_paths','read_paths','blocked_paths']) {
    if (!strings(t[key]) || (key === 'write_paths' && !t[key].length) || !t[key].every(validatePattern)) e.push(key);
  }
  for (const key of ['prerequisites','required_gates','promotion_gates','read_first']) if (!strings(t[key])) e.push(key);
  if (!array(t.required_manual_checks) || !t.required_manual_checks.every(x => typeof x?.id === 'string' && typeof x.description === 'string')) e.push('required_manual_checks');
  if (!array(t.open_findings) || !array(t.rounds)) e.push('findings/rounds');
  if (!Number.isSafeInteger(t.round) || t.round < 0 || !Number.isSafeInteger(t.updated_seq)) e.push('round/updated_seq');
  if (!['auto','approval'].includes(t.promote_policy) || !['ff_only','overlay_allowed'].includes(t.promote_mode)) e.push('promote policy/mode');
  if (t.baseline_sha !== null && !isSha40(t.baseline_sha)) e.push('baseline_sha');
  if (t.accepted_sha !== null && !isSha40(t.accepted_sha)) e.push('accepted_sha');
  if (t.accepted_tree !== null && !isSha40(t.accepted_tree)) e.push('accepted_tree');
  if (LOCKED.has(t.state) && !t.claim && !(t.state==='BLOCKED'&&t.blocked?.from==='AVAILABLE')) e.push('claim missing');
  if (t.claim && t.claim.agent!==t.builder) e.push('claim agent');
  if (t.state === 'ACCEPTED' && (!t.accepted_sha || !t.accepted_tree)) e.push('accepted object missing');
  if (t.state === 'BLOCKED' && (!t.blocked || !STATES.includes(t.blocked.from) || !BLOCK_REASONS.includes(t.blocked.reason))) e.push('blocked');
  if (t.review && (!isSha40(t.review.sha) || !isSha40(t.review.tree) || t.review.round !== t.round)) e.push('review');
  if (['PUBLISHED','REVIEWING','ACCEPTED'].includes(t.state) && !t.review) e.push('current review missing');
  if (t.review && array(t.rounds) && (t.rounds.at(-1)?.sha!==t.review.sha || t.rounds.at(-1)?.tree!==t.review.tree || t.rounds.at(-1)?.branch!==t.review.branch)) e.push('review/round mismatch');
  if (t.state==='ACCEPTED' && t.review && (t.accepted_sha!==t.review.sha || t.accepted_tree!==t.review.tree)) e.push('acceptance/review mismatch');
  if (array(t.rounds) && t.rounds.length !== t.round) e.push('rounds length');
  if (array(t.rounds) && t.rounds.some((r, i) => r.n !== i + 1 || !isSha40(r.sha) || !isSha40(r.tree) || !isSha40(r.baseline))) e.push('round record');
  if (array(t.write_paths) && array(t.blocked_paths) && anyOverlap(t.write_paths,t.blocked_paths)) {
    // A narrow blocked carve-out is permitted; freeze still enforces it.
    if (!t.blocked_paths.every(b => t.write_paths.some(w => b !== w && b.startsWith(w.replace(/\*\*$/, ''))))) e.push('write/blocked overlap');
  }
  return e;
}
export function validateManifest(m) {
  const e=[]; if (!m || !isSha40(m.sha) || !isSha40(m.tree) || !isSha40(m.baseline)) e.push('manifest sha/tree/baseline');
  if (!Number.isSafeInteger(m?.round) || m.round < 1 || !array(m?.changes) || !/^[0-9a-f]{64}$/.test(m?.changes_sha256 || '')) e.push('manifest changes');
  if (array(m?.changes) && m.changes.some(c => !['A','M','D'].includes(c.status) || !validatePath(c.path) || c.old_blob !== null && !isSha40(c.old_blob) || c.new_blob !== null && !isSha40(c.new_blob))) e.push('manifest change entries');
  if (typeof m?.task !== 'string' || typeof m.branch !== 'string' || !/^review\/[a-z0-9-]+-r[1-9][0-9]*$/.test(m.branch) || typeof m.builder !== 'string' || typeof m.session !== 'string' || !Number.isSafeInteger(m.published_seq)) e.push('manifest identity');
  if (m.previous_round_sha !== null && !isSha40(m.previous_round_sha)) e.push('manifest previous round');
  if (!array(m.delta_from_previous)) e.push('manifest delta');
  if (!array(m?.gates) || m.gate_evidence_kind !== 'builder_attested') e.push('manifest gates'); return e;
}
export function validateFinding(f) {
  const e=[]; if (typeof f?.id !== 'string' || !f.id || typeof f.blocking !== 'boolean') e.push('id/blocking');
  if (!['critical','high','medium','low'].includes(f.severity)) e.push('severity');
  if (!strings(f.paths) || !f.paths.length || !f.paths.every(validatePattern)) e.push('paths');
  for (const k of ['observed','expected','minimal_repair']) if (typeof f[k] !== 'string' || !f[k]) e.push(k);
  if (!['test','gate','manual'].includes(f.regression_proof?.kind) || typeof f.regression_proof?.description !== 'string') e.push('regression_proof');
  if (typeof f.requires_scope_change !== 'boolean') e.push('requires_scope_change'); return e;
}
export function validateResult(r) {
  const e=[]; if (!r || !isSha40(r.reviewed_sha) || !isSha40(r.reviewed_tree) || !Number.isSafeInteger(r.round)) e.push('result object');
  if (!['ACCEPT','FIX_REQUIRED'].includes(r?.verdict)) e.push('verdict');
  if (!array(r?.findings) || r.findings.some(f => validateFinding(f).length)) e.push('findings');
  for (const k of ['prior_findings','manual_checks','evidence_reuse']) if (!array(r?.[k])) e.push(k);
  if (r.task !== undefined && typeof r.task !== 'string') e.push('task');
  if (r.reviewer !== undefined && typeof r.reviewer !== 'string') e.push('reviewer');
  if (r.session !== undefined && typeof r.session !== 'string') e.push('session');
  if (r.result_seq !== undefined && !Number.isSafeInteger(r.result_seq)) e.push('result_seq');
  return e;
}
export function validateEvent(e) {
  const errors=[];
  if (!Number.isSafeInteger(e?.seq) || e.seq<1 || !/^[0-9a-f]{64}$/.test(e?.prev||'')) errors.push('seq/prev');
  if (typeof e?.ts!=='string' || !Number.isFinite(Date.parse(e.ts))) errors.push('ts');
  if (typeof e?.type!=='string' || !/^[a-z]+\.[a-z_]+$/.test(e.type)) errors.push('type');
  if (!['agent','human'].includes(e?.actor?.kind) || typeof e.actor.id!=='string' || typeof e.actor.session!=='string' || typeof e.actor.host!=='string') errors.push('actor');
  if (typeof e?.witnessed!=='boolean' || typeof e?.override!=='boolean') errors.push('witnessed/override');
  if (e?.task != null && typeof e.task!=='string') errors.push('task');
  if (!e?.data || typeof e.data!=='object' || Array.isArray(e.data)) errors.push('data');
  return errors;
}
