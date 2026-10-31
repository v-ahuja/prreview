import { readFile } from 'node:fs/promises';

const [summaryPath, ratesPath] = process.argv.slice(2);
if (!summaryPath || !ratesPath) throw new Error('Usage: node eval/cost.js eval/results/<run>/summary.json rates.json');
const summary = JSON.parse(await readFile(summaryPath, 'utf8'));
const rates = JSON.parse(await readFile(ratesPath, 'utf8'));
for (const model of new Set(summary.flatMap(item => item.models.map(result => result.model)))) {
  const rate = rates[model];
  if (!rate) { console.log(`${model}: no rate supplied`); continue; }
  if (!Number.isFinite(rate.input) || !Number.isFinite(rate.output)) throw new Error(`${model}: input and output rates per million tokens required`);
  const rows = summary.map(item => ({ pr: item.pr, ...item.models.find(result => result.model === model) })).filter(row => row.usage);
  const costs = rows.map(row => ({ pr: row.pr, usd: (row.usage.input * rate.input + row.usage.output * rate.output + row.usage.cacheRead * (rate.cacheRead ?? rate.input) + row.usage.cacheWrite * (rate.cacheWrite ?? rate.input)) / 1_000_000 }));
  for (const cost of costs) console.log(`${model} ${cost.pr}: $${cost.usd.toFixed(4)}`);
  if (costs.length) console.log(`${model} median: $${costs.map(x => x.usd).sort((a,b) => a-b)[Math.floor(costs.length / 2)].toFixed(4)} (${costs.length} PRs)`);
}
