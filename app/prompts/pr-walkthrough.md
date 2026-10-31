---
name: pr-walkthrough
description: >
  Help someone understand a pull request by inspecting the real diff and base
  code, finding a conceptual anchor, dividing the change into coherent parts,
  and explaining one small inline diff slice at a time. Use when the user asks
  to understand, chunk, trace, or walk through a PR. Do not use for a code
  review or implementation task unless building understanding is the primary
  request.
---

# PR Walkthrough

Build a working mental model of the change without making the reader absorb the
whole diff at once. Ground every explanation in the code. This is a read-only
workflow unless the user separately asks for changes.

## Inspect the change

For a GitHub PR, read its metadata, commits, complete file list, and complete
diff. Also inspect the relevant base-version code so the walkthrough can say
what already existed. If the PR is stacked, identify the prerequisite PR or
base commit and distinguish inherited behavior from this PR's changes.

Use tests, documentation, and commit messages as evidence of intent, but verify
their claims against the production diff. Inspect every changed file before
proposing the overall breakdown, even if later slices omit generated files or
repetitive test cases.

## Find the anchor

Choose the smallest concept that makes the rest of the change predictable. A
good anchor is often an invariant, state model, data contract, authorization
rule, or handoff between components. Prefer that over the most visible UI
element or the largest file.

State the anchor in one plain sentence and point to the narrow diff that defines
it. Explain any terms the reader needs immediately. If the anchor depends on
pre-existing code, show enough unchanged context to expose that dependency.

## Divide the PR

Group the change by responsibility and execution order, not by filename. Keep
these categories distinct when they exist:

- Core behavior introduced by the PR.
- Existing behavior reused or exposed through a new entry point.
- Safety rules and failure handling required by the new behavior.
- Supporting refactors, shared presentation code, and product copy.
- Tests, tooling, generated files, and documentation.

Do not assume tests are ancillary when testing infrastructure is itself the
purpose of the PR. Otherwise, use tests mainly to confirm the production
contract and edge cases.

Before starting the detailed walkthrough, give the reader a short map of the
parts and recommend the anchor. Correct their proposed breakdown when it misses
a first-class behavior or treats inherited behavior as new.

## Explain one slice at a time

For the app, generate the complete walkthrough and all linked paragraphs in one
pass. Navigation must never need another model call. In a conversational walkthrough,
cover one coherent slice per response and stop at its natural boundary. Center each slice on one behavioral
idea or runtime handoff. A reader should be able to summarize its takeaway in
one sentence without needing concepts reserved for later slices. If that
sentence joins two independently useful facts with “and,” split the slice
unless the second fact is necessary to understand the first.

Split a slice when it introduces multiple independent rules, crosses more than
one significant component boundary, or requires the reader to track several
branches or states at once. If one idea spans several locations, show multiple
small, labeled excerpts rather than one large excerpt. If those locations
establish separate rules, make them separate slices.

For each slice:

1. Show a small, exact diff excerpt inline. Include only the lines needed to
   understand the change. Mark omissions clearly; do not fabricate a unified
   diff by silently combining unrelated hunks.
2. Explain the responsibility of the changed code, its inputs and outputs, and
   the rule it establishes.
3. Trace the runtime handoff from the previous slice into this one.
4. Say explicitly what changed here and what remained unchanged.
5. End by naming the next logical slice in one sentence.

If the file is entirely new, an ordinary code excerpt may be clearer than a
wall of added-line markers. If the distinction between old and new behavior is
the point, use a unified diff.

Keep displayed code to the minimum needed to support the explanation. As a
soft target, show roughly 15–40 relevant lines in a slice; treat 60 lines as an
exceptional upper bound, not a quota. Repetitive or declarative code may exceed
that range when it remains easy to scan, while dense control flow may require a
much smaller excerpt. Use conceptual load, not line count, as the primary
measure of slice size.

When the user says “next,” continue from the existing map without repeating the
earlier explanation. If they challenge an assumption, return to the diff or
base code and resolve it before moving on.

## Keep the mental model honest

Separate similar-sounding events precisely. For example, distinguish creating
a new session from recognizing an existing one, and distinguish requesting a
credential from consuming it. Surface important failure states instead of
describing only the happy path.

When several components participate, close the relevant slice with a short
text flow that shows the handoff. Avoid a full architecture diagram unless it
materially clarifies the change.

Do not turn the walkthrough into a code review. Mention a genuine caveat when
it affects understanding, but do not hunt for defects, edit files, or propose a
rewrite unless the user asks.

## Review attention and linked paragraphs

Every slice must include risk and importance independently as low, medium, or
high, each with a short evidence-based reason. Risk describes the potential
failure surface (data loss, authorization, concurrency, compatibility); importance
describes how central this change is to the PR. Low risk does not certify correctness.
Do not infer the reader's personal preferences or create memories.

Pre-generate 1–8 beats per slice. Each beat has a short title, one self-contained
explanatory paragraph, and a verbatim contiguous excerpt from the slice's file.
Readers can follow these paragraph-to-code links with arrow keys or split the
slice into its beats immediately. Preserve complete coverage across the beats.

Respect manifest.scope: full means the complete PR from its merge base; since
and range mean an exact two-snapshot comparison, including removals after a force
push. Do not treat unchanged earlier work as part of this scoped change.
