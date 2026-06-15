# Tasks: Model Groups data layer + TUI

## Setup & Prerequisites

- [x] Create `model-groups/types.ts` with data model types exported from the package
- [x] Create `model-groups/store.ts` with stubbed CRUD functions (return empty/null for all)
- [x] Create `model-groups/tui.ts` with stubbed TUI component factory
- [x] Create `model-groups/command.ts` with `/model-groups` command registration stub
- [x] Add `modelGroups` state slice to `state.ts` (`AgenticodingState`)
- [x] Create `tests/unit/model-groups-crud.test.ts` with test structure and describe blocks
- [x] Create `tests/unit/model-groups-tui.test.ts` with test structure and describe blocks
- [x] Create `tests/unit/model-groups-integration.test.ts` with extension/session_start test structure

## Core Implementation

### Phase 1 — Data layer

- [x] Implement `loadModelGroups(cwd): ModelGroupsLoadResult` — parse global + project JSON files, merge with project override, and return typed load issues without importing UI
- [x] Implement `saveModelGroups(scope, cwd, config)` — atomic per-file write (temp file → rename), preserve unrelated top-level keys, throw typed operation/scope/path/phase details on temp-write/rename/access-denied failure
- [x] Implement `createGroup(scope, cwd, name, def)` — write new group, reject same-scope collision
- [x] Implement `updateGroup(scope, cwd, name, def)` — overwrite existing group, reject if missing
- [x] Implement `renameGroup(scope, cwd, oldName, newName)` — reject same-scope collision, rename in-place
- [x] Implement `deleteGroup(scope, cwd, name)` — remove from scope file, return override-warning metadata
- [x] Implement `moveGroup(cwd, name, newScope)` — target-first cross-scope move, reject target collision, never remove source before target write succeeds, and report target-written/source-retained partial failure when source removal fails
- [x] Implement `validateModelGroups(loadResult, modelRegistry)` — check each loaded model ref via `find()` + `hasConfiguredAuth()`, compute unavailable/shadowed/degraded
- [x] Implement malformed-JSON recovery — parse error → `.bak` backup + empty config for that scope + `ModelGroupsLoadIssue.kind === "corrupt-json"`
- [x] Implement schema-invalid recovery — parseable invalid shape → `.bak` backup + empty config for that scope + `ModelGroupsLoadIssue.kind === "schema-invalid"`
- [x] Implement recovery backup failure handling — leave original file untouched, use empty config only in memory, include backup-failure detail in `ModelGroupsLoadIssue`, make later CRUD mutators refuse to overwrite unrecovered files, and let caller notify
- [x] Implement version gating — unknown version > current → refuse load + empty config for that scope + `ModelGroupsLoadIssue`
- [x] Implement `listResolvedModelGroups(cwd, modelRegistry)` — merged groups with validation metadata plus load issues for caller notification

### Phase 2 — TUI screens

- [x] Implement screen state machine (LIST, EDITOR, MODEL_EDIT, WIZARD_PROVIDER, WIZARD_MODEL, WIZARD_THINKING, DELETE_CONFIRM)
- [x] Implement `renderList()` — group rows with health tags, `+ Add group` final row, validation info line
- [x] Implement `renderEditor()` — name input (row 2), Location selector (rows 0-1 project/global), model rows with status tags, `+ Add model…` row
- [x] Implement `renderModelEdit()` — provider/modelId/availability display, thinking options filtered by `getSupportedThinkingLevels()`, "Remove model" row
- [x] Implement wizard steps — `renderWizProv()` (live providers), `renderWizModel()` (filtered by provider), `renderWizThink()` (filtered by model capability, inherit always available)
- [x] Implement `renderDeleteConfirm()` — group summary, override warning if same-name in other scope, Keep/Delete rows

### Phase 3 — TUI interaction

- [x] Implement `handleInput()` — dispatch to active screen's list/component, D delete guard from Pi active input/focus state (no DOM selectors), Esc back-navigation, arrows, Enter activation
- [x] Implement `activate()` — Enter on rows triggers correct screen transitions and CRUD operations
- [x] Implement `+ Add group` unique-name helper in the TUI/command layer (`new-group`, then `new-group-N`) before calling strict `createGroup`
- [x] Implement immediate-apply editing — name row-change/Enter/Esc calls `renameGroup`, Location switches call `moveGroup`, thinking changes and model adds/removes call `updateGroup`, refresh visible state only after success, notify on persistence errors, and preserve last confirmed visible state on failure
- [x] Implement `maxRow()` per screen for arrow clamping

### Phase 4 — Plugin integration

- [x] Register `/model-groups` command in `index.ts` through `registerModelGroupsCommand(pi, state)` — command handler calls `ctx.ui.custom()` and creates the TUI with live `ctx.modelRegistry` and `ctx.cwd`
- [x] Add boot validation in `session_start` handler — calls `loadModelGroups()`/`validateModelGroups()`, stores validation state, surfaces unavailable/override counts and corrupt/schema-invalid/unsupported-version load issues (including backup-failure detail) via `ctx.ui.notify()`

## Verification & Proof

- [x] Write unit tests for `loadModelGroups` / `saveModelGroups` round-trip (TAP-02, TAP-09, TAP-10)
- [x] Write unit tests for `createGroup` persisting a caller-provided unique name and rejecting same-scope collisions (TAP-02)
- [x] Write unit tests for `renameGroup` success and collision rejection (TAP-03, TAP-05)
- [x] Write unit tests for `deleteGroup` with and without override warning (TAP-06)
- [x] Write unit tests for `moveGroup` success-path movement and collision rejection (TAP-04)
- [x] Write unit tests for `validateModelGroups` against mock registry (TAP-01)
- [x] Write unit tests for malformed JSON recovery returning `.bak` + empty config + `ModelGroupsLoadIssue.kind === "corrupt-json"` (TAP-07)
- [x] Write unit tests for unknown version rejection returning empty config + `ModelGroupsLoadIssue` (TAP-08)
- [x] Write unit tests for schema-invalid parseable JSON recovery returning `.bak` + empty config + `ModelGroupsLoadIssue.kind === "schema-invalid"` (TAP-21)
- [x] Write unit tests for recovery backup/access failure preserving the original file, including backup-failure detail, and blocking later CRUD overwrite of the unrecovered file (TAP-22)
- [x] Write unit tests for temp-write/rename/delete/move I/O failures throwing typed details, preserving committed files before commit, and reporting target-written/source-retained partial moves (TAP-23)
- [x] Write unit tests for TUI list validation summary/health tags, screen state machine, and row clamping (TAP-11)
- [x] Write unit tests for D key guard against Pi active input/focus state; no DOM `[data-input]` selectors (TAP-12)
- [x] Write unit tests for wizard flow with mock registry and Step 3 building the model entry passed to persistence (TAP-13)
- [x] Write unit tests for thinking level filtering per model and producing the changed entry for persistence (TAP-14)
- [x] Write extension integration unit tests for `index.ts` `session_start` boot validation and load-issue notifications via `ctx.ui.notify()` (TAP-16)
- [x] Write TUI unit tests for `+ Add group` computing `new-group` / `new-group-N` before calling `createGroup` (TAP-17)
- [x] Write TUI unit tests for editor name row-change/Enter/Esc calling `renameGroup` before navigation (TAP-18)
- [x] Write TUI unit tests for Location project↔global actions calling `moveGroup` and preserving old scope on collision (TAP-19)
- [x] Write TUI unit tests for LIST `D` → delete confirmation → confirmed `deleteGroup`, including same-name other-scope warning (TAP-20)
- [x] Write TUI unit tests for CRUD persistence errors causing `ctx.ui.notify()` and keeping list/editor visible state on last confirmed data (TAP-23)
- [x] Write extension command-adapter tests for `registerModelGroupsCommand` registering `/model-groups`, invoking `ctx.ui.custom()`, and passing `ctx.modelRegistry`/`ctx.cwd` into the component (TAP-24)
- [x] Write TUI unit tests for add-model Step 3, thinking changes, and model remove calling `updateGroup`, refreshing only after success, and notifying/preserving visible state on persistence errors (TAP-25)
- [x] Run `node ./scripts/run-node-test.mjs tests/unit/model-groups-crud.test.ts tests/unit/model-groups-tui.test.ts tests/unit/model-groups-integration.test.ts` — focused model-groups tests pass
- [x] Run `npm test` — all unit tests pass

## Feedback Amendments

- [x] FB-002: update add-model Step 2 so `renderWizModel()` only offers models for which `modelRegistry.hasConfiguredAuth(model)` is true.
- [x] FB-001: update wizard key handling so Esc and ← use the same back-step behavior (thinking→model, model→provider, provider→editor).
- [x] Add/adjust `tests/unit/model-groups-tui.test.ts` coverage for authorized-only picker choices (TAP-13) and Esc/← wizard back parity (TAP-26).
- [x] FB-003: update selected list/row option rendering so selected markers and primary labels use Pi `accent` foreground (`theme.fg("accent", ...)`; current built-in dark `#8abeb7`) consistently.
- [x] Add/adjust `tests/unit/model-groups-tui.test.ts` coverage for selected option accent styling with a sentinel theme (TAP-27).
- [x] Run focused model-groups tests and full `npm test` after implementation.

## Integration & Cleanup

- [x] Automated Pi custom-component smoke: `/model-groups` list render → create → edit → add model → delete confirm → Esc-equivalent input paths
- [x] Verify boot notification appears on session start with malformed/schema-invalid/unsupported-version configs, backup-failure detail, and missing model refs
- [x] Verify `+ Add group` is final row, no Validate row reachable
- [x] Verify D delete works on list and model edit; D in active Pi text-entry state/name input types `d`
- [x] Update `CHANGELOG.md` with Model Groups entry
