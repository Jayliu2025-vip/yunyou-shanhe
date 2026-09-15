import assert from 'node:assert/strict';
import test from 'node:test';
import { drawArt, drawArtFallback, stampArtUrl, propArtUrl } from '../js/art.js';

const requests = [];
globalThis.Image = class {
  naturalWidth = 0;
  naturalHeight = 0;
  set src(url) { this.url = url; requests.push(this); }
};

test('missing artwork stays drawable through a local fallback', () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (_, name) => (...args) => calls.push([name, ...args]), set: () => true });
  assert.equal(drawArt(ctx, 'test-missing.svg', 0, 0, 60), false);
  requests.at(-1).onerror();
  drawArtFallback(ctx, 10, 10, 60);
  assert(calls.some(([op]) => op === 'fill'));
  assert(calls.some(([op]) => op === 'stroke'));
  assert(!calls.some(([op]) => op === 'drawImage'));
});

test('loaded tall props preserve aspect ratio and use one image instance', () => {
  const calls = [];
  const ctx = { drawImage: (...args) => calls.push(args) };
  const url = propArtUrl('water');
  assert.equal(drawArt(ctx, url, 40, 60, 40, 80), false);
  const img = requests.at(-1);
  img.naturalWidth = 100; img.naturalHeight = 400; img.onload();
  const count = requests.length;
  assert.equal(drawArt(ctx, url, 40, 60, 40, 80), true);
  assert.deepEqual(calls[0].slice(1), [30, 20, 20, 80]);
  assert.equal(requests.length, count);
});

test('unknown artwork ids resolve locally or are rejected', () => {
  assert.equal(stampArtUrl('../private'), stampArtUrl('xihu'));
  assert.equal(propArtUrl('../private'), null);
});
