export function validatePattern(input) {
  if (typeof input !== 'string' || !input || input.startsWith('/') || /[?[\]{}\\!]/.test(input)) return false;
  const s = input.endsWith('/') ? input.slice(0, -1) : input;
  return s.split('/').every(x => x && x !== '.' && x !== '..' && (!x.includes('**') || x === '**'));
}
const segments = p => (p.endsWith('/') ? p + '**' : p).split('/');
function segmentMatch(pattern, value) {
  let states = new Set([0]);
  const close = input => {
    const out = new Set(input);
    for (const i of out) if (pattern[i] === '*') out.add(i + 1);
    return out;
  };
  states = close(states);
  for (const c of value) {
    const next = new Set();
    for (const i of states) {
      if (pattern[i] === '*') next.add(i);
      else if (pattern[i] === c) next.add(i + 1);
    }
    states = close(next);
  }
  return states.has(pattern.length);
}
export function matches(pattern, path) {
  if (!validatePattern(pattern) || !validatePattern(path) || path.endsWith('/')) return false;
  const p = segments(pattern), q = path.split('/'), memo = new Map();
  function go(i, j) {
    const k = i + ':' + j;
    if (memo.has(k)) return memo.get(k);
    let ok = i === p.length ? j === q.length : p[i] === '**'
      ? go(i + 1, j) || (j < q.length && go(i, j + 1))
      : j < q.length && segmentMatch(p[i], q[j]) && go(i + 1, j + 1);
    memo.set(k, ok); return ok;
  }
  return go(0, 0);
}
function segOverlap(a, b) {
  const alphabet = new Set([...a, ...b].filter(c => c !== '*')); alphabet.add('\u0000');
  const seen = new Set(), todo = [[0, 0, false]];
  while (todo.length) {
    const [i, j, used] = todo.pop(), key = `${i}:${j}:${used}`;
    if (seen.has(key)) continue; seen.add(key);
    if (i === a.length && j === b.length && used) return true;
    if (a[i] === '*') todo.push([i + 1, j, used]);
    if (b[j] === '*') todo.push([i, j + 1, used]);
    if (i < a.length && j < b.length) for (const c of alphabet) {
      if ((a[i] === '*' || a[i] === c) && (b[j] === '*' || b[j] === c))
        todo.push([a[i] === '*' ? i : i + 1, b[j] === '*' ? j : j + 1, true]);
    }
  }
  return false;
}
export function overlap(left, right) {
  if (!validatePattern(left) || !validatePattern(right)) throw new Error('invalid path pattern');
  const a = segments(left), b = segments(right), seen = new Set(), todo = [[0, 0]];
  while (todo.length) {
    const [i, j] = todo.pop(), key = `${i}:${j}`;
    if (seen.has(key)) continue; seen.add(key);
    if (i === a.length && j === b.length) return true;
    if (a[i] === '**') todo.push([i + 1, j]);
    if (b[j] === '**') todo.push([i, j + 1]);
    if (i < a.length && j < b.length && (a[i] === '**' || b[j] === '**' || segOverlap(a[i], b[j])))
      todo.push([a[i] === '**' ? i : i + 1, b[j] === '**' ? j : j + 1]);
  }
  return false;
}
export const anyOverlap = (a, b) => a.some(x => b.some(y => overlap(x, y)));
