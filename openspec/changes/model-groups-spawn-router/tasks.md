# Tasks: Model Groups spawn router

## Setup & Prerequisites

- [x] Confirm `model-groups-data-layer-tui` story is complete and current in the main `pi-agenticoding` tree.
- [x] Add `model-groups/router.ts` with exported route/effective-name helpers and test seams.
- [x] Add `model-groups/autocomplete.ts` with `#group` provider registration helper.
- [x] Add `tests/unit/model-groups-router.test.ts`.
- [x] Add `tests/unit/model-groups-autocomplete.test.ts`.

## Core Implementation

### Phase 1 — Router

- [x] Implement effective group names from `ResolvedModelGroup[]`, respecting project-over-global merge outputs and exposing only effective names.
- [x] Implement omitted-group route: parent model + parent thinking.
- [x] Implement unknown-group fallback route: parent model + parent thinking plus fallback metadata.
- [x] Implement known empty-group error with group name and `empty` reason.
- [x] Implement known all-unusable-group error with group name and `no-usable-models` reason.
- [x] Implement usable-entry filtering via `modelRegistry.find(provider, modelId)` and `modelRegistry.hasConfiguredAuth(model)`.
- [x] Implement random per-call selection with an injectable RNG seam.
- [x] Implement thinking resolution: entry `thinkingLevel` wins, absent inherits parent, final value is clamped to selected model capability.

### Phase 2 — Spawn tool contract and execution

- [x] Update `SPAWN_PARAMETERS` to advertise `prompt` plus optional `group?: string`; remove advertised `thinking`.
- [x] Update spawn prompt guidelines/description to describe group routing and omission fallback without advertising `thinking`.
- [x] Keep execution tolerant of stale `thinking` args but ignore them.
- [x] Call the router from `executeSpawn()` before creating the child session.
- [x] Pass selected model/thinking to `createAgentSession()`.
- [x] Prefer `ctx.modelRegistry` and `ctx.modelRegistry.authStorage` for child execution; keep fresh registry/auth as fallback/test seam only.
- [x] Preserve child isolation: in-memory session manager, inherited executable tools, no child `spawn`/`handoff`, shared notebook tools.
- [x] Ensure selected model is resolved once per spawn call and not re-rolled on later retry/error handling.

### Phase 3 — Prompt injection and refresh

- [x] Add a shared Model Groups state refresh helper usable by `session_start`, `/model-groups` mutations, and `before_agent_start` defensive refresh.
- [x] Inject a names-only Model Groups prompt section in `before_agent_start` when effective groups exist.
- [x] Include exact-name, known/confident mapping, `#group` interpretation, and omit/fallback guidance.
- [x] Assert prompt injection does not include provider IDs, model IDs, auth details, validation details, or persistence paths.
- [x] Ensure first prompt after handoff/compaction sees current effective group names.

### Phase 4 — Autocomplete

- [x] Register a Pi-native `#group-name` autocomplete provider when UI is available.
- [x] Match current-token `#<partial>` prefixes and offer effective group names with compact model/thinking descriptions.
- [x] No-op/delegate outside `#` prefixes.
- [x] Read from live `state.modelGroups` so group changes update suggestions where possible.
- [x] Keep autocomplete as prompt text only; do not parse `#group` into spawn params in extension code.

### Phase 5 — Result rendering

- [x] Extend `SpawnResultDetails` with route metadata/provider/model fields.
- [x] Add a shared identity-line formatter for default/routed/unknown-fallback displays.
- [x] Preserve default display as `model • thinking`.
- [x] Render routed display as `group → provider/model • thinking`.
- [x] Render unknown fallback display as `group? fallback → provider/model • thinking`.
- [x] Update snapshots/tests for collapsed, expanded, and static result paths.
- [x] Remove stale call-rendering hints that display `thinking` as a spawn argument.

## Verification & Proof

- [x] TAP-01: spawn schema/guidelines expose `group` and not `thinking`; stale `thinking` ignored.
- [x] TAP-02: effective names project-over-global behavior covered.
- [x] TAP-03: omitted group inherits parent model/thinking and existing child isolation remains green.
- [x] TAP-04: usable-entry filtering and RNG selection covered.
- [x] TAP-05: unknown group fallback route and renderer metadata covered.
- [x] TAP-06: empty/no-usable known group errors covered.
- [x] TAP-07: explicit/inherited/clamped thinking covered.
- [x] TAP-08: parent registry/auth passed to child session; fallback seam covered.
- [x] TAP-09: names-only prompt injection and refresh behavior covered.
- [x] TAP-10: `#group` autocomplete suggestions/no-op/live-state behavior covered.
- [x] TAP-11: default/routed/fallback renderer formats covered.
- [x] TAP-12: source/test guard confirms no picker, parser, meta-model proxy, advanced policies, or provider/model override params.
- [x] Run focused command from story Verification Commands.
- [x] Run `npm test` from `/workspaces/chunkhound_workspace/pi-agenticoding`.

## Integration & Cleanup

- [x] Update any relevant spawn snapshots.
- [x] Update `CHANGELOG.md` if implementation lands in this story.
- [x] Confirm `/model-groups` mutations refresh shared state for prompt/autocomplete visibility.
- [ ] Optional manual Pi smoke: create groups, type `#`, ask for a routed spawn, inspect result identity line.
