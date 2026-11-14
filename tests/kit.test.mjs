// Unit tests for the parts of the kit that can run outside a browser:
// hashing, the shared scene, the check definitions and compare.py.
// The browser checks themselves must be run in a real browser via index.html.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// scene.js and tests.js are classic browser scripts that define globals,
// so load them into one sandbox the way the page does.
function loadKit() {
  const sandbox = { crypto: globalThis.crypto, TextEncoder, Uint8Array, Float32Array, Math, Array, Set, Object, JSON, RegExp, Promise };
  vm.createContext(sandbox);
  for (const f of ['scene.js', 'tests.js']) vm.runInContext(readFileSync(join(root, f), 'utf8'), sandbox, { filename: f });
  return sandbox;
}

function recordingContext() {
  const calls = [];
  const ctx = new Proxy({}, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return (...args) => {
        calls.push(prop);
        return { addColorStop() {} };
      };
    },
    set(target, prop, value) { target[prop] = value; return true; },
  });
  return { ctx, calls };
}

test('sha256Bytes matches the SHA-256 test vector for "abc"', async () => {
  const kit = loadKit();
  const hash = await kit.sha256Bytes(new TextEncoder().encode('abc'));
  assert.equal(hash, 'ba7816bf8f01cfea');
});

test('sha256Bytes hashes a typed-array view, not its whole buffer', async () => {
  const kit = loadKit();
  const backing = new Float32Array([1, 2, 3, 4]);
  const view = backing.subarray(1, 3);
  const expected = await kit.sha256Bytes(new Uint8Array(new Float32Array([2, 3]).buffer));
  assert.equal(await kit.sha256Bytes(view), expected);
});

test('drawScene draws text only when asked', () => {
  const kit = loadKit();
  const plain = recordingContext();
  kit.drawScene(plain.ctx, false);
  assert.ok(!plain.calls.includes('fillText'));
  const withText = recordingContext();
  kit.drawScene(withText.ctx, true);
  assert.ok(withText.calls.includes('fillText'));
});

test('drawScene paints an opaque background first', () => {
  const kit = loadKit();
  const { ctx, calls } = recordingContext();
  kit.drawScene(ctx, false);
  assert.equal(calls[0], 'fillRect');
  assert.match(ctx.fillStyle, /^#|^rgba\(/);
});

test('native targets are well formed and unique', () => {
  const kit = loadKit();
  const seen = new Set();
  for (const [iface, method, len] of kit.NATIVE_TARGETS) {
    assert.match(iface, /^[A-Z]\w+$/);
    assert.match(method, /^[a-z]\w+$/);
    assert.ok(Number.isInteger(len) && len >= 0);
    const key = `${iface}.${method}`;
    assert.ok(!seen.has(key), `duplicate ${key}`);
    seen.add(key);
  }
});

test('REPEAT defaults to 5', () => {
  assert.equal(loadKit().REPEAT, 5);
});

function runCompare(base, cand) {
  const dir = mkdtempSync(join(tmpdir(), 'fpkit-'));
  const b = join(dir, 'b.json'), c = join(dir, 'c.json');
  writeFileSync(b, JSON.stringify(base));
  writeFileSync(c, JSON.stringify(cand));
  return execFileSync('python3', [join(root, 'compare.py'), b, c], { encoding: 'utf8' });
}

const row = (id, status, details = {}) => ({ id, group: 'x', name: `check ${id}`, status, details });

test('compare.py flags status changes and keeps run order', () => {
  const out = runCompare(
    { userAgent: 'base', results: [row('C1', 'pass'), row('A1', 'pass')] },
    { userAgent: 'cand', results: [row('C1', 'fail'), row('A1', 'pass')] });
  assert.match(out, /\| C1 \| check C1 \| pass \| fail \| STATUS CHANGED \|/);
  assert.match(out, /\| A1 \| check A1 \| pass \| pass \|  \|/);
  assert.ok(out.indexOf('| C1 ') < out.indexOf('| A1 '));
  assert.match(out, /1 check\(s\) flagged/);
});

test('compare.py flags differing info values and shared failures', () => {
  const out = runCompare(
    { userAgent: 'base', results: [row('A6', 'info', { sampleRate: 48000 }), row('N1', 'fail')] },
    { userAgent: 'cand', results: [row('A6', 'info', { sampleRate: 44100 }), row('N1', 'fail')] });
  assert.match(out, /A6 .* value differs/);
  assert.match(out, /N1 .* fails in both/);
});

test('compare.py reports checks missing from one side', () => {
  const out = runCompare(
    { userAgent: 'base', results: [row('C1', 'pass'), row('C9', 'pass')] },
    { userAgent: 'cand', results: [row('C1', 'pass')] });
  assert.match(out, /\| C9 \| check C9 \| pass \| - \| STATUS CHANGED \|/);
});

test('the Chrome baseline in results/ passes every non-info check', () => {
  const data = JSON.parse(readFileSync(join(root, 'results', 'chrome-157-windows.json'), 'utf8'));
  const bad = data.results.filter(r => r.status !== 'pass' && r.status !== 'info');
  assert.deepEqual(bad, []);
});
