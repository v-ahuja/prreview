import '../src/env.js';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareEvidence, runModel } from '../src/generate.js';
import { validateWalkthrough } from '../src/validate.js';

const allCases = [
  ['pydantic', 'pydantic', 13874],
  ['astral-sh', 'ruff', 28915],
  ['vitejs', 'vite', 23565],
  ['pydantic', 'pydantic', 13824]
];
const selectedCase = process.argv.find(arg => arg.startsWith('--case='))?.slice('--case='.length);
const cases = selectedCase ? allCases.filter(([owner, repo, number]) => `${owner}/${repo}#${number}` === selectedCase) : allCases;
if (!cases.length) throw new Error('Unknown --case; use owner/repo#number from the fixed public set');
const models = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const prepareOnly = process.argv.includes('--prepare-only');
if (!prepareOnly && !models.length) throw new Error('Pass one or more provider/model IDs, or --prepare-only');
const outputDir = join(process.cwd(), 'eval', 'results', `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`);
await mkdir(outputDir, { recursive: true });
const summary = [];

for (const [owner, repo, number] of cases) {
  const name = `${owner}-${repo}-${number}`;
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}`, { headers: { 'User-Agent': 'pr-walkthrough-eval', Accept: 'application/vnd.github+json' } });
  if (!response.ok) throw new Error(`${name}: GitHub HTTP ${response.status}`);
  const pull = await response.json();
  if (pull.base.repo.private) throw new Error(`${name} is private; evaluation is restricted to public PRs`);
  const root = await mkdtemp(join(tmpdir(), 'walkthrough-eval-'));
  try {
    const evidence = await prepareEvidence({ owner, repo, number, baseSha: pull.base.sha, headSha: pull.head.sha, title: pull.title, token: null, root });
    const entry = { pr: pull.html_url, baseSha: pull.base.sha, headSha: pull.head.sha, changedFiles: evidence.changedFiles.length, diffBytes: Buffer.byteLength(evidence.diff), models: [] };
    console.log(`${name}: ${entry.changedFiles} files, ${entry.diffBytes} diff bytes`);
    for (const model of models) {
      const started = Date.now();
      try {
        const output = await runModel({ agent: evidence.agent, model });
        const validated = validateWalkthrough(output.result, evidence.diff, evidence.changedFiles);
        const result = { model, passed: true, latencyMs: Date.now() - started, usage: output.usage, slices: validated.slices.length };
        const safeModel = model.replace(/[^a-zA-Z0-9_-]/g, '_');
        await writeFile(join(outputDir, `${name}-${safeModel}.json`), JSON.stringify(validated, null, 2));
        entry.models.push(result);
      } catch (error) {
        entry.models.push({ model, passed: false, latencyMs: Date.now() - started, error: error.message });
      }
    }
    summary.push(entry);
    await writeFile(join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2));
  } finally { await rm(root, { recursive: true, force: true }); }
}
console.log(`Results: ${outputDir}`);
