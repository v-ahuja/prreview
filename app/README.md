# PR Walkthrough workspace

A GitHub-connected PR inbox with on-demand walkthroughs and a diff-first review workspace. Implements the [Notion spec](https://app.notion.com/p/Walking-through-a-PR-for-a-human-is-difficult-3e684650228a80a2934cfa3913e1d853), including PR management. The spec's “Later” agent memories are deliberately excluded.

## What is included

- A signed-in inbox with repository, author, requested-review, state, text, and walkthrough-ready filters.
- Conversation, commit, changed-file, and check views. Comments, inline comments/replies, approvals, change requests, teammate/team reviewer requests, assignees, labels, title/description edits, close/reopen, and merge write through to GitHub as the signed-in user.
- `@username` and `@org/team` mentions with suggestions. Sending a comment or requesting a reviewer triggers GitHub's normal notifications. Available suggestions respect GitHub permissions; entering a known username still works when suggestions are unavailable.
- A GitHub App bot that imports installed repositories, reconciles every five minutes, and consumes signed webhooks. Sync does not generate walkthroughs by default. New repository settings are manual, and a separate global switch blocks automatic jobs even for repositories with older automation settings.
- PRs open to Files changed: unified/split diffs, syntax highlighting, whitespace filtering, wrapped lines, file filtering, viewed state, collapsed files, and expanded context from the pinned merge base/head. Click or Shift-click line numbers to comment on a line/range; stage multiple comments and submit them in a single GitHub review.
- **Generate a walkthrough** lets a contributor select Codex CLI, Claude Code, or OpenCode, enter a model, choose the scope, and start one shared run. The queue records the requester, harness and model, and deduplicates by model as well as commit/scope. Chat has independent harness/model controls.
- Markdown in comments, replies, review drafts, walkthrough prose and chat, including tables, fenced code and Mermaid diagrams. Composers offer Write/Preview, Mermaid insertion, an Excalidraw editor, and `.excalidraw` import. Mermaid flowcharts convert to editable Excalidraw scenes locally, without a model call. Scenes render inline, reopen for editing, and download as `.excalidraw`; Mermaid diagrams export as SVG. HTML and active embeds are disabled.
- Instant slice navigation; separate risk and importance explanations; arrow-key paragraph links to exact code; pre-generated smaller parts for splitting complex slices; low-risk skipping; collapsible contextual chat with explicit text/code selections and optional PNG/JPEG/WebP images (2 MB).
- A locally bundled Monaco editor with syntax highlighting, multiple changed files, base/head switching, find/replace, language workers, editable scratch copies, and download. Expand a snippet by 20 source lines at a time. Scratch edits are kept in the current tab; they do not modify the PR or push commits. This embeds the editor, not VS Code's terminal, extension host, or a remote development environment.
- Whole-PR walkthroughs, exact changes since a reader's last completed full review, and inclusive contiguous commit ranges. Earlier versions remain accessible in review history and always use their pinned source commits. Completing a partial or archived review does not move the current full-review baseline.



## Run the local app

The local app needs Node.js 22 or newer, Git, [GitHub CLI](https://cli.github.com/), and either an installed [Codex CLI](https://developers.openai.com/codex/cli/) or [Claude Code CLI](https://code.claude.com/docs/en/setup). It uses your `gh` login to read PRs and your selected runner's own login to generate a walkthrough. No Docker, Postgres, GitHub App registration, or model API key is needed by this app.

From a clone of this repository:

```sh
cd app
npm ci
npm install -g .
pr-walkthrough open "https://github.com/owner/repo/pull/123" --runner codex
# Or: pr-walkthrough open "https://github.com/owner/repo/pull/123" --runner claude
```

The command prompts for `gh auth login` if needed, starts a server bound to `127.0.0.1`, and opens the browser at a URL containing `?pr=`. Use `--model ID` to override the runner's default model, or `--no-browser` to print the URL without opening it. `pr-walkthrough serve` starts the server without selecting a PR; enter a PR URL in the page. Keep the terminal open while using the app and press Ctrl+C to stop it.

Walkthroughs are saved in the user's application data directory and remain pinned to the PR's base and head commits. The app checks GitHub access before showing a saved walkthrough. Its server, evidence preparation, and saved output run locally; GitHub and the selected model service still receive network requests. The selected CLI may send PR code to its configured model service.

For development without a global install, run `npm run local -- open "https://github.com/owner/repo/pull/123" --runner codex`. A packed npm tarball can be made with `npm pack` and installed with `npm install -g ./pr-walkthrough-app-0.1.0.tgz`.

## Hosted workspace

Walkthrough generation is manual by default. `GENERATION_ENABLED=true` permits the Generate button and explicitly submitted chat questions. `AUTOMATIC_GENERATION_ENABLED=false` prevents sync/webhooks from queuing jobs and prevents the worker from claiming automatic jobs. Opening PRs, syncing GitHub, and rendering/converting diagrams use no AI credits. To opt into automatic generation, enable both switches and set a repository's bot mode to `on_open` or `on_update`.

Set `GENERATION_ENABLED=false` to disable all model calls while retaining sign-in, sync, GitHub review actions, and existing walkthroughs. Stop the connected process and its active model descendants before changing this switch; cancel queued/running jobs if they must not resume, then restart. Changing environment settings alone does not cancel a request already in progress.

GitHub is the source of truth for PRs and collaboration. Each reader signs in with GitHub; the app checks access before showing cached walkthroughs, archived code, or chat. The bot uses installation tokens for background sync. Walkthrough-link comments are opt-in with `PUBLISH_WALKTHROUGH_LINKS=true`. Human actions use GitHub App user tokens and are subject to GitHub permissions and branch protection. Reviews and merges submit the displayed head SHA and reject stale submissions. A contributor with write access can also request generation manually.

The hosted app bundles its generation instructions in [`prompts/pr-walkthrough.md`](prompts/pr-walkthrough.md). OpenCode runs the selected provider/model against a prepared, read-only evidence bundle. The resulting excerpts and changed-file accounting are validated before publication. A failed validation leaves the run unpublished and exposes a retry action. When link publishing is enabled, one bot comment links to the stable hosted PR page. Older versions remain available by their pinned base/head pair.

## Connect the workspace on this computer

Use PostgreSQL for durable sessions, synchronized PRs, and walkthrough jobs. Create a dedicated database first, then run:

```sh
cd app
DATABASE_URL=postgres://localhost/prreview \
SETUP_GITHUB_LOGIN=your-github-login \
WALKTHROUGH_RUNNER=codex \
npm run connected
```

Open [http://127.0.0.1:3100](http://127.0.0.1:3100), connect GitHub, and choose the repositories to install. The manifest flow creates the GitHub App, saves its credentials into `app/.env` with mode `0600`, migrates the database, and starts the web app and worker. Existing configuration is never overwritten. GitHub requires confirmation of the app permissions and may require organization approval. On later starts, run `npm run connected` with no extra variables.

The setup uses your installed Codex login (or `WALKTHROUGH_RUNNER=claude`) to generate walkthroughs and answer contextual questions. Set `WALKTHROUGH_MODEL` before setup to select a model; otherwise the CLI default applies. Selected private repositories are processed by that runner's configured service. The local setup initially allows only the operator's GitHub login; add allowed teammates to `ALLOWED_GITHUB_LOGINS` when deploying a shared workspace. App secrets and GitHub tokens are removed from the generation subprocess environment, and Codex runs read-only without loading unrelated user integrations.

Sign-in imports the repositories accessible to both the user and the app. The worker polls GitHub every five minutes. It imports PRs without queuing AI work. Walkthroughs run after a contributor clicks Generate; optional automation requires both global and repository opt-in. Webhooks are inactive for the local setup, so no public tunnel is necessary. Organization installations are activated when an allowed user signs in or uses **Sync GitHub**. Background generation requires the computer and worker to remain running. Bot comments are off by default; comments and reviews submitted by a person in the workspace still write through to GitHub.

## GitHub App registration

Create a GitHub App with:

| Setting | Value |
| --- | --- |
| Homepage | `PUBLIC_ORIGIN` |
| Callback URL | `PUBLIC_ORIGIN/auth/callback` |
| Webhook URL | `PUBLIC_ORIGIN/webhook` |
| Repository permissions | Contents: read and write (merge); Pull requests: read and write; Issues: read and write (labels/assignees/comments); Checks: read; Commit statuses: read; Metadata: read (implicit) |
| Optional repository permission | Administration: read for repository-team suggestions; without it, enter team slugs manually |
| Webhook events | Pull request; Pull request review; Pull request review comment; Issue comment; Issues; Installation; Installation repositories |

See GitHub's [GitHub App registration](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app), [user token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app), and [installation token](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app) documentation for these settings.

Enable expiring user access tokens. Set `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_PRIVATE_KEY_BASE64`, and `GITHUB_WEBHOOK_SECRET` from that registration. Base64 encode the entire PEM private key, including its header and footer. Set `SESSION_ENCRYPTION_KEY` to 32 random base64 encoded bytes (`openssl rand -base64 32`). Set `PUBLIC_ORIGIN` to the exact external origin; HTTPS is required outside local development.

The bot can read the complete PR through an installation token. The viewer uses a GitHub App user token; the app fetches the PR with that token before displaying stored content. Repository admin mode changes use the user's GitHub repository permission. Uninstalling the app deletes stored PRs and walkthroughs for that installation. Removing a repository from an installation deletes its stored data.

## Preview the UI

```sh
cd app
npm ci
npm run demo
```

Open [http://localhost:3000](http://localhost:3000) for the PR inbox, then open the article-sync PR. This interactive preview uses synthetic data and needs no Docker, database, GitHub sign-in, or model credential. Demo comments and reviews update in-memory fixtures only; chat explicitly returns a sample answer. Restarting clears demo actions. The other sample PR rows reuse the article-sync walkthrough and say so when opened.

## Run the hosted stack locally

```sh
cd app
cp .env.example .env
# Fill .env, including POSTGRES_PASSWORD and a model credential.
docker compose up --build
```

The web app listens on port 3000. The connected local setup above uses loopback OAuth callbacks and polling. For immediate webhooks, configure an HTTPS endpoint and set `PUBLIC_ORIGIN` accordingly. For a remote deployment, run the same web, worker, migration and Postgres services with persistent Postgres storage and TLS at the edge. The worker needs outbound access to GitHub and the selected model provider. Keep the worker isolated from unrelated infrastructure; OpenCode's tool permissions are a guard, not an OS sandbox.

Without a CLI runner, the `worker` requires `WALKTHROUGH_MODEL` in `provider/model` form, such as an OpenCode supported OpenAI or Google model, plus its provider API credential. Do not set a production model until the public PR evaluation below passes. Private PR generation is disabled unless the exact model ID appears in `PRIVATE_ALLOWED_MODELS` after you approve its data handling. The web process also needs the provider credential for contextual chat. Each request uses its selected harness/model and the same private-model allowlist. Installed CLI choices use their existing logins; OpenCode requires a provider/model ID and credential. The environment values supply the initial selection. Sync works without a model configured. Chat images require a model with image support.

## Model evaluation

```sh
cd app
npm ci
npm run eval -- --prepare-only
npm run eval -- openai/<candidate> google/<candidate>
```

The fixed evaluation set contains four verified public PRs of different sizes. The tool fetches complete Git diffs, prepares the same evidence bundle as production, runs each candidate, validates exact excerpts and file accounting, and writes artifacts plus latency/usage data to ignored `eval/results/`. Use [the rubric](eval/RUBRIC.md) for a human quality score and cost calculation. Do not send private code to a provider before its data handling is approved. A local model can be evaluated through OpenCode as another candidate.

## Verification

```sh
npm test
# Include queue, synchronization, and hosted access tests against a disposable migrated DB:
DATABASE_URL=postgres://localhost/prreview_test npm run migrate
TEST_DATABASE_URL=postgres://localhost/prreview_test npm test
npm run test:ui
```

Browser tests use an installed Google Chrome and a temporary local demo server on port 3101. They cover inbox filtering, the default diff, split/whitespace/context controls, ranged draft reviews, explicit harness/model selection, Markdown/Mermaid rendering, Excalidraw conversion/import/viewing, navigation, source editing, mentions, and mobile layout. Tests use synthetic GitHub responses; they never post to a real repository.

`npm ci` builds the editor, language workers, diff viewer, Markdown/Mermaid renderer, and Excalidraw assets locally. Diagram libraries load on demand; no rendering service is used. `npm run build` rebuilds them after dependency changes. The build replaces Monaco's vendored DOMPurify with the patched dependency; simply overriding the npm dependency would leave its prebuilt browser bundle unchanged. Generated files in `public/vendor/` are ignored by Git.

Run migrations before upgrading an existing hosted deployment. Legacy walkthroughs stay archived and new generation uses the v2 format. In the local app, “Upgrade walkthrough” regenerates older saved data while retaining its previous version.

## Scope and limits

- Live end-to-end GitHub OAuth, installation webhooks, and model output require configured credentials. The demo is a preview, not a deployment or a connected account.
- The editor supports text files up to 1 MB. New/deleted files have only the applicable side; renamed files resolve their original base path. Binary or oversized files show an explicit message. GitHub's Files view may omit a large/binary patch; the walkthrough generator independently validates complete snapshot diffs.
- This is a PR review workspace, not complete GitHub product parity: repository creation, branch creation, milestones/projects, draft toggles, review dismissal, thread resolution, and check reruns remain on GitHub. It does not push scratch edits or install VS Code extensions.
- Drawings are limited to 1 MB and 1,000 elements. GitHub comment bodies still have a 65,000-character limit, so larger drawings must be downloaded. Mermaid-to-Excalidraw conversion supports flowcharts; other Mermaid diagram types remain SVG. GitHub itself displays the Excalidraw fence as JSON; this workspace renders it as a drawing.
- Chat history stays in the browser tab and is scoped to the current slice. Reader progress and the last completed full-review SHA are review state, not agent memories. No preference learning or cross-PR memory is implemented.
- Generation is capped at 200 changed files and 450 KB of diff output. It prepares up to 1 MB of extended diff context and 1 MB of smaller base files. PRs above the file or diff limits fail explicitly instead of publishing a partial walkthrough.
- A repository can queue at most 20 new versions per day, and each version gets at most three attempts. Older queued versions are skipped after a force push, limiting unnecessary model spend.
- For a whole PR, the worker resolves the merge base and computes the complete snapshot diff. Scoped reviews compare their exact start/end snapshots, including a previous reviewed head that was force-pushed away, as long as GitHub can still serve that commit. A new head creates a new version; old versions stay pinned.
- Actual model quality and per-PR cost require provider credentials and human evaluation. A CLI runner uses its existing account and usage limits; API-provider mode uses its configured API credential.
