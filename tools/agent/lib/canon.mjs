import { createHash } from 'node:crypto';

export function canonicalJSON(value, { pretty = false } = {}) {
  function sort(v) {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])]));
    if (typeof v === 'number' && !Number.isSafeInteger(v)) throw new Error('non-integer JSON number');
    return v;
  }
  return JSON.stringify(sort(value), null, pretty ? 2 : 0) + (pretty ? '\n' : '');
}
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const isSha40 = s => typeof s === 'string' && /^[0-9a-f]{40}$/.test(s);
