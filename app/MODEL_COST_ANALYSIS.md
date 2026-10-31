# PR walkthrough model and cost analysis

_Researched 2026-09-26. Prices and availability can change; confirm them when running the evaluation._

## Decision status

No candidate has yet passed a human-scored PR walkthrough evaluation in this project. Model suitability below is a hypothesis, not a measured result. The app's [evaluation rubric](eval/RUBRIC.md) and four public PR cases provide the comparison gate. The walkthrough task reads and explains code; it does not generate code. It must still understand material changes, distinguish changed from unchanged behavior, choose useful excerpts, and cover every changed file or explain an omission.

## Local models on the 16 GB M4 Mac

| Candidate | Ollama Q4 download | Evaluation role |
| --- | ---: | --- |
| `qwen3.5:2b-q4_K_M` | 1.9 GB | Small per-file summaries or classification; test whole-walkthrough output only as a lower bound. |
| `qwen3.5:4b-q4_K_M` | 3.4 GB | First small whole-walkthrough candidate. |
| `qwen3.5:9b-q4_K_M` | 6.6 GB | Primary local candidate for coherent final synthesis. |
| `gemma4:12b-it-q4_K_M` | 7.6 GB | Independent local comparison. |

The [Qwen3.5 tags](https://ollama.com/library/qwen3.5/tags) and [Gemma 4 tags](https://ollama.com/library/gemma4/tags) give download sizes. Running memory also includes the context cache and other overhead, so advertised maximum context is not a promise that a large PR fits in 16 GB. Local inference has **no per-token API fee**, but uses the reviewer's machine, time, and electricity.

Ollama is suitable for a local evaluation. [OpenCode can use Ollama](https://docs.ollama.com/integrations/opencode), but the current runner writes an isolated `opencode.json` without an Ollama provider, so it needs configuration work before `npm run eval` can use it. A second, direct Ollama API experiment should feed bounded PR sections to the model and combine the findings. This may reduce agent overhead and context needs. The [64K context guidance](https://docs.ollama.com/context-length) applies to using **OpenCode as a coding agent**; it is not a requirement inherent to a walkthrough. Measure actual prompt sizes and memory for both approaches before choosing one.

## Hosted comparison and illustrative costs

The example below assumes **20,000 uncached input tokens and 3,000 billable output tokens for the entire walkthrough**. Formula: `(input tokens × input rate + output tokens × output rate) / 1,000,000`. Real runs can make multiple calls and use more output or reasoning tokens. These figures exclude hosting, storage, retries, and any provider-specific extras.

| Candidate | Standard USD per 1M input / output tokens | Example cost | Role |
| --- | ---: | ---: | --- |
| [Gemini 2.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/pricing) | $0.10 / $0.40 | $0.0032 | Low-cost hosted candidate already named in the eval rubric. |
| [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) | $0.10 / $0.50 | $0.0035 | Low-cost hosted candidate. |
| [DeepSeek V4.1 Flash on Fireworks](https://fireworks.ai/models/deepseek-ai/deepseek-v4p1-flash) | $0.22 / $0.66 | $0.00638 | Chinese-model comparison on a US provider's serverless API. |
| [Gemini 3.1 Flash-Lite](https://ai.google.dev/gemini-api/docs/pricing) | $0.25 / $1.50 | $0.0095 | Newer Google comparison; verify exact OpenCode model support. |
| [GPT-6 Sol](https://developers.openai.com/api/docs/models/gpt-6-sol) | $2.00 / $10.00 | $0.0700 | Stronger reference for quality. |
| [Kimi K3 on Fireworks](https://fireworks.ai/models/fireworks/kimi-k3) | $3.00 / $15.00 | $0.1050 | Stronger Chinese-model reference, expensive as a default. |
| Kimi K3 US-only route | Standard K3 rates + 10% | $0.1155 | Data residency comparison when US-only inference is required. |

Fireworks explicitly lists the Kimi K3 US-only serverless model ID as `accounts/fireworks/routers/kimi-k3-us` and says the route costs 10% more than standard K3. The cited DeepSeek V4.1 Flash page confirms serverless availability and price, **not** US-only routing. A provider based in the US does not by itself establish US-only processing.

## Evaluation and product implications

Run the same four public PRs through the local candidates, inexpensive hosted candidates, and a stronger reference. Record exact model IDs, quantization or endpoint, prompt structure, input/output tokens, context size, peak memory for local runs, latency, and actual spend. Human review should score factual accuracy, material-change coverage, useful anchor and slice ordering, excerpt support, and readability. The existing validator checks exact excerpts and file accounting, but cannot establish that the explanation is correct. Select a production default only after comparing artifacts, not from token prices alone.

The current hosted worker pays for provider calls with its configured API credential. A user's Claude or ChatGPT subscription is not automatically an API billing method. If the product later lets reviewers use local Ollama to bear their own compute cost, the hosted app needs a local companion that runs on their machine and returns the completed walkthrough; the hosted worker cannot invoke a model on a reviewer's laptop directly. Keep this architecture decision separate from the local UI demo.
