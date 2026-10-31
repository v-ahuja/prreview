import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { diff, changedFiles, walkthrough } from '../demo/fixture.js';
import { validateWalkthrough } from '../src/validate.js';
import { layout, renderWalkthrough, diffHtml } from '../src/view.js';

test('demo fixture has exact excerpts and one hidden section per slice', () => {
  validateWalkthrough(walkthrough, diff, changedFiles);
  const html = renderWalkthrough(walkthrough);
  assert.equal((html.match(/class="slice walkthrough-step"/g) || []).length, 4);
  assert.equal((html.match(/data-step="[1-3]" hidden/g) || []).length, 3);
  assert.equal((html.match(/class="checkpoint-button"/g) || []).length, 4);
  assert.match(html, /Queue saves/);
  assert.match(html, /Send batch/);
  assert.match(html, /Merge articles/);
  assert.match(html, /0 of 3 slices/);
  assert.doesNotMatch(html, /<dt>|Inputs and outputs|Still the same/);
});

test('shared view escapes sample code and demo layout omits live controls', () => {
  const html = renderWalkthrough({
    ...walkthrough,
    slices: [{ ...walkthrough.slices[0], title: '<script>', navLabel: '<img src=x>', excerpt: '+<script>"&' }]
  });
  assert.match(html, /&lt;script&gt;/);
  assert.match(diffHtml('+<script>"&'), /\+&lt;script&gt;&quot;&amp;/);
  assert.match(html, /\\u003cscript\\u003e/);
  assert.match(html, /&lt;img src=x&gt;/);
  assert.doesNotMatch(html, /<script>/);
  const demo = layout('Sample', html, null, { demo: true });
  assert.match(demo, /Demo data/);
  assert.doesNotMatch(demo, /auth\/login|auth\/logout|github\.com/);
  const live = layout('Sample', '', null);
  assert.match(live, /Sign in with GitHub/);
  assert.match(live, /Review and comment on GitHub/);
});

test('walkthrough prose renders safe markdown', () => {
  const html = renderWalkthrough({
    ...walkthrough,
    anchor: {
      ...walkthrough.anchor,
      rule: 'Keep `routing_key` **unchanged**.',
      explanation: 'Use [`Queue`](https://example.com/docs).\n\n- First item\n- Second item\n\n<script>alert(1)</script>'
    },
    slices: [{
      ...walkthrough.slices[0],
      takeaway: 'Preserves an *empty* `routing_key`.',
      next: 'Next: **publishing**'
    }, walkthrough.slices[1]]
  });
  assert.match(html, /Keep <code>routing_key<\/code> <strong>unchanged<\/strong>\./);
  assert.match(html, /<a href="https:\/\/example\.com\/docs"><code>Queue<\/code><\/a>/);
  assert.match(html, /<ul>\s*<li>First item<\/li>/);
  assert.match(html, /Preserves an <em>empty<\/em> <code>routing_key<\/code>\./);
  assert.match(html, /Next: <strong>publishing<\/strong>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});
