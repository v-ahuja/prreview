# Public PR model gate

Run the same four public PRs with each candidate model:

```sh
npm run eval -- openai/gpt-6-luna google/gemini-2.5-flash-lite
```

The initial matrix is GPT-6 Luna, Gemini Flash Lite, a hosted Gemma option, and GPT-6 Sol as the stronger reference. Add Qwen Coder, DeepSeek Flash, and Kimi K3 through supported OpenCode providers on **public PRs only**. Verify the exact current model IDs with `./node_modules/.bin/opencode models` before running. Keep private code on providers explicitly approved for it. The command saves the generated artifacts and automated validation results under `eval/results/`.

For each artifact, a human reviewer records:

| Measure | Pass rule |
| --- | --- |
| Anchor | The anchor makes the rest of the PR predictable and is backed by its excerpt. |
| Coverage | Every material changed behavior appears in a slice; omissions are genuinely repetitive or generated. |
| Truth | No material misunderstanding of the diff or base behavior. |
| Excerpts | All displayed excerpts are exact and support the prose. The validator enforces exact diff membership. |
| Usability | Reviewer rates the walkthrough at least 4/5 for understanding the PR. |
| Spend | Typical generation cost is below $0.05, calculated from actual input/output token counts and current provider rates. |
| Latency | Reviewer accepts the time from queue to ready. |

Do not enable a model for production merely because its price is low. Compare it with a stronger reference model on the same PRs. Record the model identifier, provider, rates and date of the comparison. No evaluation result is claimed until real model calls and human review are complete.

For cost, create a JSON file mapping exact model IDs to current USD rates per million tokens, for example `{"provider/model":{"input":0.1,"output":0.5,"cacheRead":0.01,"cacheWrite":0.125}}`, then run `node eval/cost.js eval/results/<run>/summary.json rates.json`. Verify prices from provider documentation on the evaluation date.
