# Local walkthrough UI demo: agent handoff

## Goal

Let someone explore a representative PR walkthrough at `http://localhost:3000` using dummy data. The demo must start without Docker, Postgres, a GitHub App, GitHub sign-in, or a model credential. It previews the walkthrough page and its navigation; it does not simulate generation or repository administration.

## Current state

- The production server in `src/server.js` requires the GitHub App and database settings at startup. Its PR page checks GitHub access and loads saved runs from Postgres.
- `compose.yaml` defines a local Postgres container, but a database is not needed for this demo. At the time this plan was written, OrbStack was available, no containers were running, and there was no `.env` or `walkthrough` database.
- The walkthrough HTML (`layout`, `diffHtml`, and `renderWalkthrough`) lives inside `src/server.js`. There is no demo route or fixture today.

## Implementation

1. Add `npm run demo` to start a small standalone HTTP server, listening on `PORT` or 3000 by default. Do not import `src/config.js`, `src/db.js`, `src/env.js`, or the production server from the demo entrypoint. The command should work after `npm ci`, with no `.env`.
2. Move the shared presentation functions needed for the walkthrough into a view module used by both servers. Keep the generated production markup and escaping behavior the same. Serve the existing `public/style.css` in the demo.
3. Add a checked-in synthetic fixture matching the validated walkthrough shape: PR title and identity, one conceptual anchor, at least three slices with all fields used by `renderWalkthrough`, and realistic contiguous diff excerpts. The fixture is presentation data, not an output of a model evaluation. Mark the page visibly as **Demo data**.
4. Serve the fixture at `/` and the stylesheet at `/style.css`. The map links must jump to their corresponding slices. Omit sign-in, generate/retry, repository settings, and external GitHub review controls on the demo page; do not show links that lead to a fictional PR. Return 404 for other paths. Use the same HTML escaping and response security headers as the production page where applicable.
5. Add a short **Preview the UI** section to `README.md` with `cd app`, `npm ci`, `npm run demo`, and the local URL. Explain that this preview requires no Docker or credentials and is separate from the live GitHub/Postgres setup.

## Verification

- With `.env` absent and no Postgres or Docker running, `npm run demo` serves the sample page and CSS. Check the visible demo label and at least three working map links.
- Check the page at desktop and phone widths, including horizontal scrolling of long diff lines.
- Run `npm test` and confirm that extraction of shared rendering functions does not change production output or access checks. If a renderer test is useful, assert that sample text is escaped and map links target real slice IDs.

## Boundaries

Do not add dummy rows to Postgres or bypass GitHub authorization in the production routes. Do not add AI generation, simulated sign-in, queue states, or settings interactions to this first demo.
