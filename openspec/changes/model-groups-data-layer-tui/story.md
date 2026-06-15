# Story: Model Groups data layer + TUI (CRUD)

Plan: 🟢 PLAN APPROVED
Status: ✅ DONE

## Purpose

The operator can open `/model-groups` from any Pi session and manage named model groups with full CRUD — create, rename, edit, and delete groups; add, edit, and remove model entries within groups (each entry specifying provider, model ID, and optional thinking level); switch group scope between project and global. On session start, all group definitions are validated against the live model registry, and health issues (unavailable model references, project overrides, degraded states) are surfaced as a boot notification and within the Model Groups list. Groups persist to durable plugin-owned JSON files in global and project scope, with project groups overriding same-name global groups. No save/discard model — all edits apply immediately.

## Actors

- **Primary:** Pi operator — opens `/model-groups` to create, edit, rename, delete model groups and their model entries; receives boot-time validation notifications.
- **System:** `ModelRegistry` — provides live model/provider data for the add-model picker and boot validation lookups.
- **System:** File system — `~/.pi/agent/pi-agenticoding/model-groups.json` (global) and `<cwd>/.pi/pi-agenticoding/model-groups.json` (project) as persistence targets.
- **System:** Pi extension runtime — loads the `pi-agenticoding` plugin on `session_start`, registers the `/model-groups` command, runs boot validation.

## Triggering Need

The pi-agenticoding plugin's spawn tool needs a model routing capability — the operator defines model groups, and spawn can select from them dynamically. Before routing can exist, the groups must be defined and managed. This story builds the CRUD foundation that routing will consume.

## Expected Prerequisites

- OpenSpec change dependencies: none.

Runtime/environment assumptions for implementation:
- `pi-agenticoding` plugin installed and operational at `/workspaces/chunkhound_workspace/pi-agenticoding`
- Plugin's `index.ts` already registers extensions (handoff, spawn, notebook)
- Pi extension API available: `ctx.ui.custom()`, `ctx.modelRegistry`, `ctx.ui.notify()`, `session_start` events
- Existing `tui.ts`, `state.ts`, `runtime-singletons.ts` provide reusable patterns

## Scope

1. **Data model + persistence** — `ModelGroupsConfig` schema, self-managed JSON files at global and project paths, full CRUD service (`loadModelGroups`, `saveModelGroups`, `createGroup`, `updateGroup`, `renameGroup`, `deleteGroup`, `moveGroup`), malformed/schema-invalid file recovery (.bak backup + reset + notify), bounded filesystem failure behavior for backup/write/rename/delete partial failures, empty groups allowed, same-scope name uniqueness enforced, version gating.

2. **TUI manager** — `/model-groups` command via `pi.registerCommand()`, single `ctx.ui.custom()` component with internal state machine driving seven screens (list, editor, model edit, wizard provider, wizard model, wizard thinking, delete confirm). Row navigation, `D` key for delete guarded by Pi active input/focus state, Esc for back, immediate-apply editing.

3. **Add-model wizard** — 3-step flow (provider → model → thinking) using live `ModelRegistry` data and filtering model choices to models with configured authorization via `ModelRegistry.hasConfiguredAuth(model)`. Thinking levels filtered by `getSupportedThinkingLevels()`. Inherit always available. No fourth review step.

4. **Boot validation** — runs on `session_start`, reports unavailable model references, project overrides, degraded states via `ctx.ui.notify()` and within the list info line.

5. **Per-model thinking** — each model entry in a group has its own optional `thinkingLevel`. Absent field means inherit. Model edit screen shows filtered thinking options.

## Out of Scope

- Spawn integration, group resolution, routing semantics
- Final invocation/call syntax
- Child-agent profiles, frontmatter, prompts, tools
- Model reordering UI
- Description field in data model
- Deleting global group also deleting project override (keep project, warn)

## Scenarios / Behavior Examples

### Normative

- **S1:** Given the plugin loads on `session_start`, when validation runs against `ModelRegistry`, then unavailable model refs, project overrides, and degraded states are identified. **Covers: A1**
- **S2:** Given boot validation completes, when issues exist, then a notification is surfaced via `ctx.ui.notify()`. **Covers: A2**
- **S3:** Given boot validation completes, when the operator opens `/model-groups`, then the list info line shows the validation summary (unavailable count, override count). **Covers: A3**
- **S4:** Given the operator types `/model-groups` in a Pi session and presses Enter, then a custom TUI opens replacing the editor area. **Covers: A4**
- **S5:** Given the Model Groups list is open, when it renders, then all merged groups display with health tags (degraded ⚠, unavailable ✗, project override) plus model count and thinking summary. **Covers: A5**
- **S6:** Given the Model Groups list is open, when navigating rows, then `+ Add group` is the final row and no `Validate` row appears. **Covers: A6**
- **S7:** Given the operator presses Enter on `+ Add group`, then the TUI computes the next unique `new-group`/`new-group-N` name, calls `createGroup` with project scope and empty models, persists immediately, and opens the editor. **Covers: A7**
- **S8:** Given the group editor is open, when the operator edits the group name and moves focus to another row, then the name is applied immediately. **Covers: A8**
- **S9:** Given the group editor is open, when the operator switches Location from project to global (or vice versa), then `moveGroup` writes to the target scope file and removes from the source scope file on success. **Covers: A9**
- **S10:** Given the operator navigates to `+ Add model…` and presses Enter, then a 3-step wizard opens: Step 1 lists live providers from `ModelRegistry`, Step 2 lists only models for the chosen provider that pass `ModelRegistry.hasConfiguredAuth(model)`, Step 3 shows thinking levels filtered by `getSupportedThinkingLevels()`. Enter on Step 3 adds the model, persists, and returns to the editor. No fourth step exists. **Covers: A10**
- **S11:** Given a model entry is selected in the group editor and the operator presses Enter, then the model edit screen opens showing provider, modelId, and availability status. **Covers: A11**
- **S12:** Given the model edit screen is open, when thinking options are displayed, then only levels supported by the model (via `getSupportedThinkingLevels()`) are shown, plus inherit which is always available. **Covers: A12**
- **S13:** Given the model edit screen is open, when the operator selects a different thinking level and presses Enter, then the change is applied immediately, persists through `updateGroup`, and the editor refreshes only after success. **Covers: A13**
- **S14:** Given the model edit screen is open, when the operator presses `D`, then the model is removed from the group, persists through `updateGroup`, and the editor re-renders reflecting the change only after success. **Covers: A14**
- **S15:** Given the operator selects a group in the list and presses `D` while no Pi text-entry state is active, then a delete confirmation screen opens with group summary. Selecting "Delete group" and Enter removes the group immediately. If a same-name group exists in the other scope, the confirmation warns it remains unaffected. **Covers: A15**
- **S16:** Given the Pi custom TUI has an active text-entry state (search, group name, wizard filter), when the operator types `d`, then the character `d` is inserted into that focused input state. The `D` delete action only fires when screen is LIST or MODEL_EDIT and the component's own focus/state says no text input is active. **Covers: A16**
- **S17:** Given a project group named `review` exists, when the operator renames another project group to `review`, then `renameGroup` rejects with a notification, and the editor stays open with the old name. **Covers: A17**
- **S18:** Given a global group `review` is edited, when the operator switches Location to project, then `moveGroup` writes to the project file and removes from the global file on success. If a project group named `review` already exists, the move is rejected. **Covers: A18**
- **S19:** Given the global `model-groups.json` contains malformed JSON, when the plugin loads on `session_start`, then the file is backed up to `model-groups.json.bak`, config resets to empty, and `ctx.ui.notify()` informs the operator. **Covers: A19**
- **S20:** Given the global `model-groups.json` has `"version": 99` (higher than the plugin supports), when the plugin loads, then it refuses to load, `ctx.ui.notify()` informs the operator, and config is treated as empty. **Covers: A20**
- **S21:** Given the project `model-groups.json` is parseable JSON but violates the `ModelGroupsConfig` schema (for example `groups` is not an object or a model entry lacks `provider`/`modelId` strings), when the plugin loads on `session_start`, then the file is backed up to `model-groups.json.bak`, that scope resets to empty, a `schema-invalid` load issue is returned, and `ctx.ui.notify()` informs the operator. **Covers: A21**
- **S22:** Given backup/write/rename/delete filesystem I/O fails while loading, saving, deleting, or moving model groups, when the operation returns to the TUI or boot handler, then existing committed config files are not silently overwritten, the operator is notified with the affected scope/path/operation, and any cross-scope move partial failure is reported without claiming a successful move. **Covers: A22**
- **S23:** Given the add-model wizard is on any wizard step, when the operator presses Esc or ←, then both keys use the same back-step behavior: thinking → model, model → provider, and provider → editor. **Covers: A23**
- **S24:** Given any Model Groups selectable list or row option is rendered, when an option is selected, then its selection marker and primary label use Pi's standard selected-option accent foreground (`theme.fg("accent", ...)`; current built-in dark theme accent `#8abeb7`, the light mint-green Pi uses for selected items) instead of a plugin-specific color. **Covers: A24**

### Orientation Only

- **S25:** Given a global group has a same-name project override, when the list renders, then the global group row shows a "project override" tag. Design source: mockup `renderList()`.
- **S26:** Given the operator presses Down arrow repeatedly on any screen, when the last row is reached, then the selection stays on the last row. Outside the add-model wizard, Esc returns through screens: editor/model-edit/delete-confirm → list → main prompt. Design source: mockup keydown handler.

## Acceptance

- **A1:** On `session_start`, validation checks all group model entries against `ModelRegistry.find()` and `hasConfiguredAuth()`; returns structured validation result with unavailable refs, project overrides, and degraded states.
- **A2:** When boot validation finds issues, `ctx.ui.notify()` surfaces a one-time message with aggregate counts (unavailable model references, project overrides).
- **A3:** Opening `/model-groups` shows a list info line with the current boot validation summary.
- **A4:** `/model-groups` opens a custom TUI component via `ctx.ui.custom()` replacing the editor area.
- **A5:** The list renders all merged groups (global + project, project overrides global for same-name) with health tags: degraded ⚠, unavailable ✗, project override.
- **A6:** The list has `+ Add group` as the final navigable row; no `Validate` row or action exists.
- **A7:** Selecting `+ Add group` makes the TUI/command layer compute the next unique name (`new-group`, `new-group-N`), call `createGroup` with project scope and empty `models: []`, persist immediately, and open the editor; `createGroup` itself still rejects same-scope name collisions.
- **A8:** Editing a group name in the editor applies immediately on the next non-name action (row change, Enter, Esc).
- **A9:** Switching Location in the editor calls `moveGroup(cwd, name, newScope)` — on success, writes the group to the target scope file and deletes it from the source scope file; filesystem failure behavior is covered by A22.
- **A10:** The add-model wizard has exactly 3 steps: provider (live list from `ModelRegistry`), model (filtered by provider and excluding models for which `ModelRegistry.hasConfiguredAuth(model)` is false), thinking (filtered by `getSupportedThinkingLevels()`). Inherit is always available. Enter on Step 3 adds the model, persists, and returns to the editor. No fourth step exists.
- **A11:** The model edit screen displays the model's provider, modelId, and availability status (available/unavailable).
- **A12:** The model edit screen thinking options are filtered by `getSupportedThinkingLevels()`. Inherit is always shown.
- **A13:** Selecting a different thinking level on the model edit screen and pressing Enter applies the change immediately by calling `updateGroup` with the modified group; on persistence failure, the TUI notifies and preserves the last confirmed visible state.
- **A14:** Pressing `D` on the model edit screen removes the model from the group by calling `updateGroup` with the modified group and returns to the editor after success; on persistence failure, the TUI notifies and keeps the model visible in the last confirmed state.
- **A15:** Pressing `D` on a selected group in the list while no Pi text-entry state is active opens a delete confirmation with summary. Confirming deletes the group immediately. If a same-name group exists in the other scope, the confirmation warns it remains unaffected.
- **A16:** `D` triggers delete only when screen is LIST or MODEL_EDIT and the Pi component's active-input/focus state says no text input is active. In a focused Pi `Input` or custom text-entry row, `d` is forwarded to `handleInput(data: string)` and types the literal character.
- **A17:** `renameGroup` rejects same-scope name collision, surfaces error via `ctx.ui.notify()`, and keeps the editor open with the old name unchanged.
- **A18:** `moveGroup` moves a group between scope files on success; rejects if target scope already has a same-name group.
- **A19:** Malformed JSON in `model-groups.json` at load: backup to `.bak`, return empty config for that scope with a `corrupt-json` load issue, notify via `ctx.ui.notify()`.
- **A20:** Unknown version in `model-groups.json` (higher than plugin supports): refuse to load, notify via `ctx.ui.notify()`, return empty config.
- **A21:** Schema-invalid but parseable `model-groups.json` at load: backup to `.bak`, return empty config for that scope with a `schema-invalid` load issue, notify via `ctx.ui.notify()`.
- **A22:** Filesystem I/O failures for backup, temp write, rename, delete/source removal, or access-denied paths are bounded: store code does not silently drop committed config, returns or throws typed operation/scope/path details, boot/TUI adapters notify via `ctx.ui.notify()`, and a failed cross-scope move leaves the visible editor state on the last confirmed scope unless a partial target-written/source-retained state is explicitly reported for retry.
- **A23:** In the add-model wizard, Esc and ← invoke the same back-step behavior: thinking → model, model → provider, and provider → editor. Non-wizard Esc behavior remains the documented screen back/exit path.
- **A24:** Selected options in all Model Groups selectable lists/rows use Pi's standard `accent` foreground for the selection marker and primary label, matching `getSelectListTheme()`/`getSettingsListTheme()` behavior; the current built-in dark theme resolves this light mint-green accent to `#8abeb7`. Implementations should reference the theme token rather than hard-coding the hex except in tests/docs that assert the discovered current value.

## Verification

### Verification Commands

Run from `/workspaces/chunkhound_workspace/pi-agenticoding` after implementation:

```bash
node ./scripts/run-node-test.mjs \
  --test-name-pattern 'model groups|model-groups|group CRUD|group validation|session_start' \
  tests/unit/model-groups-crud.test.ts \
  tests/unit/model-groups-tui.test.ts \
  tests/unit/model-groups-integration.test.ts

npm test
```

Plus automated Pi custom-component smoke coverage for `/model-groups` render/input behavior; the HTML mockup is a design source only and is not an executable proof target for Pi-native TUI focus behavior. A live Pi dev-session smoke remains useful exploratory reviewer evidence but is not the approval proof for A3/A5/A15.

### Test Architecture Plan

| Row ID | Layer / Scope | Behavior / Acceptance Slice | Owning Suite / File(s) | Boundary Exercised | Assertions / Observability | Fixture / Test Data Strategy | CI Lane / Command | Fallback Plan | Split / Merge Rationale |
|--------|--------------|---------------------------|----------------------|--------------------|---------------------------|----------------------------|-------------------|---------------|------------------------|
| TAP-01 | Unit — data layer | A1: boot validation against ModelRegistry | tests/unit/model-groups-crud.test.ts | `validateModelGroups()` ↔ `ModelRegistry` | Returns structured `ModelGroupValidation` with unavailable refs, shadowed, degraded | Mock registry with known models; groups config with mix of valid/invalid refs | `npm test` in plugin | `node ./scripts/run-node-test.mjs <test-file>` | Covers data layer validation independently |
| TAP-02 | Unit — data layer | A7: `createGroup` immediate persist for caller-provided unique name; same-scope collision rejected | tests/unit/model-groups-crud.test.ts | `createGroup()` → filesystem | Group written to correct scope file with supplied unique name; duplicate name throws and files stay unchanged | Temp dir mimicking project/global paths | `npm test` in plugin | `node ./scripts/run-node-test.mjs tests/unit/model-groups-crud.test.ts` | Covers store create path without hiding name-generation ownership |
| TAP-03 | Unit — data layer | A8: renameGroup immediate rename | tests/unit/model-groups-crud.test.ts | `renameGroup()` | File updated with new name, old name absent | Pre-populated temp file | `npm test` in plugin | `node ./scripts/run-node-test.mjs <test-file>` | Covers store rename independently from the TUI callsite proof |
| TAP-04 | Unit — data layer | A9/A18: moveGroup success path + collision | tests/unit/model-groups-crud.test.ts | `moveGroup()` across two scope files | On success, source file no longer has group and target file has it; collision rejected | Two temp files, one pre-populated with colliding name | `npm test` in plugin | `node ./scripts/run-node-test.mjs <test-file>` | Covers store move independently from the TUI callsite proof; failure branches are covered by TAP-23 |
| TAP-05 | Unit — data layer | A17: renameGroup collision rejection | tests/unit/model-groups-crud.test.ts | `renameGroup()` same-scope collision | Throws error, files unchanged | Pre-populated with colliding names | `npm test` in plugin | `node ./scripts/run-node-test.mjs <test-file>` | Collision is same rename code path |
| TAP-06 | Unit — data layer | A15: deleteGroup with override warning | tests/unit/model-groups-crud.test.ts | `deleteGroup()` | Global group removed, project group untouched, warning metadata returned | Both scopes have same-name group | `npm test` in plugin | `node ./scripts/run-node-test.mjs <test-file>` | Covers store delete independently from the TUI confirmation proof |
| TAP-07 | Unit — data layer | A19: malformed JSON → backup + reset + load issue | tests/unit/model-groups-crud.test.ts | `loadModelGroups()` corrupt path | `.bak` file created, empty config returned, `ModelGroupsLoadIssue.kind === "corrupt-json"` emitted with scope/path | Malformed JSON on disk | `npm test` in plugin | `node ./scripts/run-node-test.mjs <test-file>` | Malformed JSON is separate from schema-invalid parseable JSON |
| TAP-08 | Unit — data layer | A20: unknown version rejection + load issue | tests/unit/model-groups-crud.test.ts | `loadModelGroups()` version check | Refuses to load, empty config returned, `ModelGroupsLoadIssue` emitted with unsupported version | JSON with `"version": 99` | `npm test` in plugin | `node ./scripts/run-node-test.mjs <test-file>` | Version gating is distinct; notification is proved by TAP-16 |
| TAP-09 | Unit — data layer | Model entries persist as {provider, modelId, thinkingLevel?} | tests/unit/model-groups-crud.test.ts | Serialization round-trip | `thinkingLevel` absent after write-read for inherit; present for explicit levels | Groups with and without thinkingLevel | `npm test` in plugin | `node ./scripts/run-node-test.mjs <test-file>` | Covers persistence format |
| TAP-10 | Unit — data layer | Empty models array valid | tests/unit/model-groups-crud.test.ts | `createGroup()` with empty models | Group persists with `"models": []`, load returns it | Temp dir | `npm test` in plugin | `node ./scripts/run-node-test.mjs <test-file>` | Edge case |
| TAP-11 | Unit — TUI | A3/A5/A6: list render contract plus screen state machine/navigation | tests/unit/model-groups-tui.test.ts | TUI render strings, screen transitions, row clamping, D delete guard | List render includes boot validation summary, degraded/unavailable/project-override health tags, final `+ Add group` row, and no Validate row; screen IDs/maxRow behave correctly; D only routes to delete-capable screens while model-entry persistence is proved at TAP-25 | In-memory state, no DOM | `npm test` in plugin | `node ./scripts/run-node-test.mjs <test-file>` | TUI logic and render contract independent of live terminal chrome; command adapter proof is TAP-24 |
| TAP-12 | Unit — TUI | A16: D key guard against Pi active input/focus state | tests/unit/model-groups-tui.test.ts | Component `handleInput(data: string)` dispatch and focused `Input`/text-entry state | D in LIST/MODEL_EDIT with no active text input triggers delete; D with active text input is forwarded as printable input and mutates only that text value | Simulated terminal input strings plus component focus/input-state fixtures; no DOM selectors | `npm test` in plugin | `node ./scripts/run-node-test.mjs tests/unit/model-groups-tui.test.ts` | Key guard is safety-critical and must be Pi-native |
| TAP-13 | Integration | A10: add-model wizard flows through authorized registry models | tests/unit/model-groups-tui.test.ts | Wizard steps, provider/model/thinking lists from registry | Provider list is populated from mock registry; model list for the chosen provider excludes models for which `hasConfiguredAuth(model)` is false; Step 3 activation builds the model entry passed to the persistence path covered by TAP-25 | Mock ModelRegistry with authorized and unauthorized models plus group draft | `npm test` in plugin | `node ./scripts/run-node-test.mjs <test-file>` | Registry integration is key Pi-native feature; persistence call/error behavior is split to TAP-25 |
| TAP-14 | Integration | A11/A12/A13: model edit + thinking filtering | tests/unit/model-groups-tui.test.ts | Model edit screen, `getSupportedThinkingLevels()` integration | Non-reasoning model shows only `[inherit]`; reasoning model shows appropriate levels; select produces the modified model entry passed to the persistence path covered by TAP-25 | Mock models with varied capabilities | `npm test` in plugin | `node ./scripts/run-node-test.mjs <test-file>` | Thinking filtering is Pi-native feature; persistence call/error behavior is split to TAP-25 |
| TAP-15 | Optional E2E / exploratory smoke | A1–A24: full user flow | live Pi dev-session smoke | `/model-groups` → list → create → edit → add model → wizard back → delete | Screens navigable, no Validate row, selected options use Pi accent/light-mint foreground, authorized-only add-model choices, Esc/← wizard back parity, D delete works, D in focused text input types; failure notifications can be simulated by temporary bad configs | Real plugin in dev session | Optional manual exploratory | Not an approval gate; defer to follow-up if unavailable | Smoke is high-cost; approval proof is covered by unit/integration tests plus automated component smoke |
| TAP-16 | Unit — extension integration | A2/A19/A20/A21/A22: `session_start` boot validation and load-error notifications | tests/unit/model-groups-integration.test.ts | `index.ts` registered `session_start` handler → `loadModelGroups()`/`validateModelGroups()` → `ctx.ui.notify()` | Handler stores validation state; calls `ctx.ui.notify()` once with unavailable/override aggregate counts when validation issues exist; calls `ctx.ui.notify()` with corrupt/schema-invalid/unsupported-version load issue summaries, including backup-failure detail when present; no notification when both counts and load issues are zero | Mock `ExtensionAPI`, `ExtensionContext`, `ModelRegistry`, temp model group files, and store load issues for global/project scopes | `npm test` in plugin | `node ./scripts/run-node-test.mjs tests/unit/model-groups-integration.test.ts` | Keeps UI notification ownership in extension integration while store stays UI-free |
| TAP-17 | Unit — TUI | A7: `+ Add group` unique-name ownership | tests/unit/model-groups-tui.test.ts | LIST activation of `+ Add group` → unique-name helper → `createGroup()` | Computes `new-group`, then `new-group-N` from merged existing names before calling `createGroup`; created group has project scope and empty `models: []`; editor opens | In-memory groups with existing project/global names; mocked store calls | `npm test` in plugin | `node ./scripts/run-node-test.mjs tests/unit/model-groups-tui.test.ts` | Proves auto-name belongs to the TUI/command layer, while store collision checks remain strict |
| TAP-18 | Unit — TUI | A8: editor name row commits to `renameGroup` | tests/unit/model-groups-tui.test.ts | EDITOR name text-entry state → row change / Enter / Esc activation → mocked store | On each supported non-name action, pending name change is flushed before navigation and `renameGroup(scope, cwd, oldName, newName)` is called exactly once; collision error triggers `ctx.ui.notify()` and keeps old name/editor | Component state with focused name input, mocked store and notify spy | `npm test` in plugin | `node ./scripts/run-node-test.mjs tests/unit/model-groups-tui.test.ts` | Proves user-facing immediate rename route, not just helper/store behavior |
| TAP-19 | Unit — TUI | A9: Location selector commits to `moveGroup` | tests/unit/model-groups-tui.test.ts | EDITOR Location row activation → mocked store | Switching project↔global calls `moveGroup(cwd, name, newScope)`, refreshes group scope from returned/reloaded state, and reports target collision via `ctx.ui.notify()` without changing selection | Component state with project/global groups, mocked store and notify spy | `npm test` in plugin | `node ./scripts/run-node-test.mjs tests/unit/model-groups-tui.test.ts` | Proves supported UI action invokes the store move boundary |
| TAP-20 | Unit — TUI | A15: list `D` + confirm routes to `deleteGroup` | tests/unit/model-groups-tui.test.ts | LIST delete chord → DELETE_CONFIRM → confirmed Enter → mocked store | `D` opens confirmation only when no text input is active; confirmation displays same-name other-scope warning from store/list state; selecting Delete calls `deleteGroup(scope, cwd, name)` and returns to refreshed LIST | Component state with override pair, mocked store and notify/render spies | `npm test` in plugin | `node ./scripts/run-node-test.mjs tests/unit/model-groups-tui.test.ts` | Proves delete is reachable from the Pi TUI user path and guarded from text-entry state |
| TAP-21 | Unit — data layer | A21: schema-invalid config → backup + reset + load issue | tests/unit/model-groups-crud.test.ts | `loadModelGroups()` schema validation boundary after JSON parse | `.bak` file created, empty config returned for the affected scope, `ModelGroupsLoadIssue.kind === "schema-invalid"` includes scope/path/message | Parseable JSON with wrong root shape and wrong model-entry shape | `npm test` in plugin | `node ./scripts/run-node-test.mjs tests/unit/model-groups-crud.test.ts` | Separates raw input shape validation from malformed JSON parsing |
| TAP-22 | Unit — data layer | A22: backup/access failure during load recovery | tests/unit/model-groups-crud.test.ts | `loadModelGroups()` recovery backup boundary plus later CRUD reload guard | If copying/renaming to `.bak` fails, original file is not overwritten, empty config is returned only for the in-memory load, `ModelGroupsLoadIssue` includes backup failure detail, later mutators refuse to overwrite that unrecovered file with a typed `load-recovery` persistence error, and notification is proved by TAP-16/TUI error adapters | Temp dir with mocked/permission-denied backup path for corrupt and schema-invalid cases, then a CRUD mutator call in the affected scope | `npm test` in plugin | `node ./scripts/run-node-test.mjs tests/unit/model-groups-crud.test.ts` | Bounds the recovery failure branch without coupling store to UI |
| TAP-23 | Unit — data layer + TUI | A22: write/rename/delete/move I/O failures are reported and do not silently commit partial state | tests/unit/model-groups-crud.test.ts; tests/unit/model-groups-tui.test.ts | `saveModelGroups()` temp write/rename, `deleteGroup()`, `moveGroup()`, and TUI mutation handlers | Store throws typed operation/scope/path/phase details; existing committed file remains unchanged on temp-write/rename failure; `moveGroup` never deletes source before target write succeeds and reports target-written/source-retained partial failures; TUI catches errors, calls `ctx.ui.notify()`, and keeps visible editor/list state on last confirmed data | Mocked `fs` failures or permission-denied temp dirs plus mocked store errors in TUI tests | `npm test` in plugin | `node ./scripts/run-node-test.mjs tests/unit/model-groups-crud.test.ts tests/unit/model-groups-tui.test.ts` | Filesystem risk is behavior-critical and needs both store and UI-adapter proof |
| TAP-24 | Unit — command adapter | A4: `/model-groups` command registration opens custom TUI | tests/unit/model-groups-integration.test.ts | `registerModelGroupsCommand(pi, state)` plus `index.ts` registration → `ctx.ui.custom()` | Mock `ExtensionAPI` records `registerCommand("model-groups")`; invoking the handler calls `ctx.ui.custom()` exactly once and passes `ctx.modelRegistry` plus `ctx.cwd` into `createModelGroupsComponent` | Mock `ExtensionAPI`, `ExtensionContext`, `ctx.ui.custom` spy, model registry sentinel, cwd sentinel | `npm test` in plugin | `node ./scripts/run-node-test.mjs tests/unit/model-groups-integration.test.ts` | Proves the slash-command adapter reaches the Pi custom UI boundary instead of only TUI internals |
| TAP-25 | Unit — TUI/store adapter | A10/A13/A14: model-entry add/thinking/remove persist through `updateGroup` | tests/unit/model-groups-tui.test.ts | Wizard Step 3, MODEL_EDIT thinking activation, MODEL_EDIT `D` remove → mocked `updateGroup(scope, cwd, name, def)` | Each user path calls `updateGroup` with the full modified group, refreshes editor/list state only after success, calls `ctx.ui.notify()` on `ModelGroupsPersistenceError`, and preserves the last confirmed visible state on failure | Component state with existing group/models, mock registry for wizard/thinking, mocked store success/error, notify spy | `npm test` in plugin | `node ./scripts/run-node-test.mjs tests/unit/model-groups-tui.test.ts` | Groups all model-entry immediate-persistence branches at the store boundary so in-memory state changes cannot satisfy proof alone |
| TAP-26 | Unit — TUI | A23: Esc and left-arrow wizard back parity | tests/unit/model-groups-tui.test.ts | `handleInput(data: string)` dispatch in WIZARD_PROVIDER, WIZARD_MODEL, and WIZARD_THINKING | Esc and ← invoke the same wizard back-step behavior: thinking → model, model → provider, and provider → editor; non-wizard Esc remains covered by TAP-11 | Simulated terminal input sequences on component state | `npm test` in plugin | `node ./scripts/run-node-test.mjs tests/unit/model-groups-tui.test.ts` | Keeps keyboard navigation proof behavior-facing and separate from persistence paths |
| TAP-27 | Unit — TUI/theme | A24: selected option highlight uses Pi accent | tests/unit/model-groups-tui.test.ts | TUI render theme callbacks / selected-row render strings | Selected list/row marker and primary label are styled through `theme.fg("accent", ...)` or `getSelectListTheme()`/`getSettingsListTheme()` equivalent; no bespoke plugin hex is used for selected options except documenting built-in dark `#8abeb7` | Mock theme with sentinel accent plus selected list/editor/wizard rows | `npm test` in plugin | `node ./scripts/run-node-test.mjs tests/unit/model-groups-tui.test.ts` | Proves visual consistency at the Pi theme boundary without depending on terminal color rendering |

### Acceptance Proof Matrix

| Acceptance ID | Proof Maturity | Proof Method | Reviewer Action | Expected Evidence | Relevant Surfaces | Open Detail |
|--------------|----------------|-------------|-----------------|------------------|------------------|-------------|
| A1 | final | Unit test (TAP-01) | `npm test` in plugin | Mock registry returns model; assert validation result shape correct with unavailable refs | `model-groups/store.ts` | — |
| A2 | final | Unit test (TAP-16) | `npm test` in plugin | Mocked `session_start` handler runs boot validation and calls `ctx.ui.notify()` once with aggregate unavailable/override counts when issues exist | `index.ts` session_start, `model-groups/store.ts` | — |
| A3 | final | Unit test (TAP-11) | `npm test` in plugin | Component render includes "Boot validation: N unavailable model references · N project overrides" from current validation state | `model-groups/tui.ts` | — |
| A4 | final | Unit test (TAP-24) | `npm test` in plugin | `registerModelGroupsCommand` registers `/model-groups`; invoking the command handler calls `ctx.ui.custom()` and passes `ctx.modelRegistry`/`ctx.cwd` to the component factory | `model-groups/command.ts`, `index.ts`, `model-groups/tui.ts` | — |
| A5 | final | Unit test (TAP-11) | `npm test` in plugin | Component render includes degraded ⚠, unavailable ✗, and project override tags for matching resolved groups | `model-groups/tui.ts` | — |
| A6 | final | Unit test (TAP-11) | `npm test` in plugin | Component render/maxRow assertions: final row is `+ Add group`, no validate items | `model-groups/tui.ts` | — |
| A7 | final | Unit tests (TAP-02, TAP-17) | `npm test` in plugin | TUI computes the next free `new-group`/`new-group-N` name before calling `createGroup`; store persists the caller-provided unique project group with empty `models: []` and still rejects collisions | `model-groups/tui.ts`, `model-groups/store.ts` | — |
| A8 | final | Unit tests (TAP-03, TAP-18) | `npm test` in plugin | Editor name row-change/Enter/Esc path flushes the pending name and calls `renameGroup`; `renameGroup` updates group name in file, old name absent | `model-groups/tui.ts`, `model-groups/store.ts` | — |
| A9 | final | Unit tests (TAP-04, TAP-19) | `npm test` in plugin | Editor Location switch calls `moveGroup(cwd, name, newScope)`; successful store move leaves source file without group and target file with it | `model-groups/tui.ts`, `model-groups/store.ts` | — |
| A10 | final | Unit tests (TAP-13, TAP-25) | `npm test` in plugin | Wizard flow: provider list from mock registry, model list filtered by provider and configured authorization, thinking list, Enter on Step 3 calls `updateGroup` with the added `{ provider, modelId, thinkingLevel? }`, refreshes after success, and notifies/preserves state on persistence failure | `model-groups/tui.ts`, `model-groups/store.ts` | — |
| A11 | final | Unit test (TAP-14) | `npm test` in plugin | Model edit screen renders provider/modelId/availability from state | `model-groups/tui.ts` | — |
| A12 | final | Unit test (TAP-14) | `npm test` in plugin | Thinking options filtered: non-reasoning model shows only inherit; reasoning model shows appropriate levels | `model-groups/tui.ts` | — |
| A13 | final | Unit tests (TAP-14, TAP-25) | `npm test` in plugin | Selecting a different thinking level produces the modified model entry and calls `updateGroup`; the editor refreshes after success and `ctx.ui.notify()`/last-confirmed state cover persistence errors | `model-groups/tui.ts`, `model-groups/store.ts` | — |
| A14 | final | Unit test (TAP-25) | `npm test` in plugin | D on MODEL_EDIT calls `updateGroup` with the model removed; success returns to the editor with refreshed model count, failure notifies and keeps the model visible | `model-groups/tui.ts`, `model-groups/store.ts` | — |
| A15 | final | Unit tests (TAP-06, TAP-20) | `npm test` in plugin | LIST `D` opens delete confirmation only outside text-entry state; confirming calls `deleteGroup`; store removes group from scope file and returns/feeds override warning metadata when same-name exists in other scope | `model-groups/tui.ts`, `model-groups/store.ts` | — |
| A16 | final | Unit test (TAP-12) | `npm test` in plugin | D with Pi active input/focus state mutates the input text; D without active input on LIST/MODEL_EDIT triggers delete behavior | `model-groups/tui.ts` | — |
| A17 | final | Unit tests (TAP-05, TAP-18) | `npm test` in plugin | `renameGroup` throws on same-scope collision with files unchanged; TUI catches the collision, calls `ctx.ui.notify()`, and keeps the editor on the old name | `model-groups/tui.ts`, `model-groups/store.ts` | — |
| A18 | final | Unit tests (TAP-04, TAP-19) | `npm test` in plugin | `moveGroup` rejects when target scope has same-name group; TUI reports collision without changing visible scope | `model-groups/tui.ts`, `model-groups/store.ts` | — |
| A19 | final | Unit tests (TAP-07, TAP-16) | `npm test` in plugin | Malformed JSON on disk → `.bak` created, empty config returned with `corrupt-json` load issue; `session_start` integration turns that issue into a `ctx.ui.notify()` warning naming the affected scope/path | `model-groups/store.ts`, `index.ts` session_start | — |
| A20 | final | Unit tests (TAP-08, TAP-16) | `npm test` in plugin | Version 99 in file → refused load, empty config returned with unsupported-version load issue; `session_start` integration turns that issue into a `ctx.ui.notify()` warning naming the affected scope/path | `model-groups/store.ts`, `index.ts` session_start | — |
| A21 | final | Unit tests (TAP-21, TAP-16) | `npm test` in plugin | Parseable but schema-invalid JSON on disk → `.bak` created, empty config returned with `schema-invalid` load issue; `session_start` integration notifies with scope/path | `model-groups/store.ts`, `index.ts` session_start | — |
| A22 | final | Unit tests (TAP-22, TAP-23, TAP-16) | `npm test` in plugin | Backup failure keeps original file untouched, includes backup-failure detail, and later CRUD mutators refuse to overwrite the unrecovered file with a typed `load-recovery` error; write/rename/delete/move failures throw typed details; TUI/boot adapters call `ctx.ui.notify()` and do not show unconfirmed saved/moved state | `model-groups/store.ts`, `model-groups/tui.ts`, `index.ts` session_start | — |
| A23 | final | Unit test (TAP-26) | `npm test` in plugin | Component input tests show Esc and ← take identical wizard back steps from thinking, model, and provider screens | `model-groups/tui.ts` | — |
| A24 | final | Unit test (TAP-27) | `npm test` in plugin | Render tests with a sentinel accent theme show selected option markers and primary labels use Pi's accent styling; docs/source inspection confirms built-in dark accent `#8abeb7` | `model-groups/tui.ts`, Pi theme `getSelectListTheme()` | — |

### Surface / Branch Proof Matrix

| Acceptance ID | User Surface / Branch | Store / Integration Boundary | Required Proof |
|---------------|-----------------------|------------------------------|----------------|
| A4 | Slash command `/model-groups` is invoked from Pi command handling | `registerModelGroupsCommand(pi, state)` → `pi.registerCommand("model-groups")` → `ctx.ui.custom()` → `createModelGroupsComponent(tui, theme, ctx.modelRegistry, ctx.cwd, done)` | TAP-24 proves the adapter registration, custom UI invocation, and live `ctx.modelRegistry`/`ctx.cwd` wiring. |
| A8 | EDITOR name text-entry loses focus through row change, Enter, or Esc | `renameGroup(scope, cwd, oldName, newName)` | TAP-18 proves the Pi component flushes the pending name before navigation; TAP-03 proves the store rename persists. |
| A9 | EDITOR Location selector changes project↔global | `moveGroup(cwd, name, newScope)` | TAP-19 proves the UI action invokes the store move boundary; TAP-04 proves successful file movement and collision rejection. |
| A10 | WIZARD_MODEL displays choices, then WIZARD_THINKING Step 3 activation adds the selected model entry | `ModelRegistry.hasConfiguredAuth(model)` filter, then `updateGroup(scope, cwd, name, def)` | TAP-13 proves provider/model/thinking choices are sourced from `ModelRegistry` and the model list excludes unauthorized models; TAP-25 proves the final activation persists through `updateGroup`, refreshes only after success, and notifies/preserves visible state on persistence error. |
| A13 | MODEL_EDIT thinking selection activation | `updateGroup(scope, cwd, name, def)` | TAP-14 proves supported thinking options; TAP-25 proves the changed entry is persisted through `updateGroup` and persistence errors notify without showing unconfirmed state. |
| A14 | MODEL_EDIT `D` removes the selected model entry | `updateGroup(scope, cwd, name, def)` | TAP-25 proves the remove branch persists the full modified group, returns to the editor after success, and keeps the removed model visible on persistence failure. |
| A15 | LIST `D` opens DELETE_CONFIRM, then confirmed Delete | `deleteGroup(scope, cwd, name)` and override-warning metadata | TAP-20 proves the reachable TUI path and warning display; TAP-06 proves scoped deletion and other-scope preservation. |
| A17 | EDITOR name text-entry attempts same-scope duplicate | `renameGroup(scope, cwd, oldName, newName)` error → TUI notification | TAP-18 proves collision is surfaced through `ctx.ui.notify()` and the editor keeps the old name; TAP-05 proves files are unchanged. |
| A18 | EDITOR Location selector attempts target-scope duplicate | `moveGroup(cwd, name, newScope)` error → TUI notification | TAP-19 proves collision is surfaced without changing visible scope; TAP-04 proves files are unchanged. |
| A19 | `session_start` loads malformed global/project JSON | Store load issue → `index.ts` notification adapter → `ctx.ui.notify()` | TAP-07 proves backup/reset/`corrupt-json` load issue; TAP-16 proves the boot handler notifies the operator. |
| A20 | `session_start` loads unsupported future version | Store load issue → `index.ts` notification adapter → `ctx.ui.notify()` | TAP-08 proves refused load/load issue; TAP-16 proves the boot handler notifies the operator. |
| A21 | `session_start` loads parseable but schema-invalid global/project JSON | Store load issue → `index.ts` notification adapter → `ctx.ui.notify()` | TAP-21 proves backup/reset/`schema-invalid` load issue; TAP-16 proves the boot handler notifies the operator. |
| A22 | Load backup failure or CRUD save/delete/move I/O failure | Store load issue or typed persistence error → boot/TUI notification adapter → `ctx.ui.notify()` | TAP-22 proves backup failure is bounded and later CRUD cannot silently overwrite unrecovered corrupt/schema-invalid files; TAP-23 proves save/delete/move failures do not silently commit partial state and keep visible UI on confirmed data. |
| A23 | WIZARD_PROVIDER, WIZARD_MODEL, and WIZARD_THINKING receive Esc or ← | TUI `handleInput(data: string)` → shared wizard back action | TAP-26 proves Esc and ← produce the same back-step behavior across wizard screens while preserving non-wizard Esc behavior under TAP-11. |
| A24 | LIST, EDITOR, MODEL_EDIT, WIZARD_PROVIDER, WIZARD_MODEL, WIZARD_THINKING, and DELETE_CONFIRM render a selected option/row | Pi theme `accent` token / `getSelectListTheme()` selected styling | TAP-27 proves selected markers and primary labels use Pi accent styling consistently across selectable Model Groups surfaces. |

### Design Sources

| Source Anchor | Status | Notes / Supersession |
|---|---|---|
| `agent_coordination/epics/model-tag-router/mockups/interactive-mockup.html` | normative | Controls visible Model Groups screen sequence, row ordering, health tags, immediate-apply UX, delete confirmation, and provider→model→thinking wizard shape where represented below. Superseded details: browser DOM `[data-input]` mechanics, stale `Step 1/4` and `Step 2/4` labels, static thinking option lists, "Agent Groups" label, and `/agent` command filter. |
| Grilled design Q9/Q19/Q23 captured in the story contract | normative | Controls data-layer behaviors not represented by the mockup: malformed/schema-invalid file backup/reset, unknown-version refusal, rename/move collision rejection, bounded filesystem failure notification, and atomic-per-file move semantics. |
| Pi source anchors (`ExtensionContext`, `ModelRegistry`, TUI `Component.handleInput`, `Input`, `getSupportedThinkingLevels`) | normative | Controls extension registration, boot notification, model lookup/auth checks, and Pi-native input/focus proof boundaries. Browser event objects and DOM selectors are not valid implementation contracts. |
| Manual feedback FB-001/FB-002 absorbed 2026-06-14 | normative | Controls Esc/left-arrow parity in the add-model wizard and authorized-only model choices in the add-model picker. |
| Pi theme docs + source (`docs/themes.md`, `theme.js::getSelectListTheme()`, built-in `dark.json`) | normative | Controls selected-option visual consistency: Pi selected items use the `accent` token; `getSelectListTheme()` applies `theme.fg("accent", ...)` to selected prefix/text; current built-in dark `accent` is `#8abeb7`. |

### Design Element Trace

| Source Anchor | Visible Element / State | Obligation | Bounds / Required Behavior | Scenario | Acceptance ID | Proof Row / Reviewer Action |
|---|---|---|---|---|---|---|
| `interactive-mockup.html::renderPiStartup()` plus Pi `ctx.ui.notify()` source | Boot validation warning surface | required | Startup/session validation issues produce an operator-visible Model Groups warning notification; copy may use Pi notification chrome but must include unavailable/override counts or load-error scope/path/backup-failure detail as applicable. | S2, S19, S20, S21, S22 | A2, A19, A20, A21, A22 | TAP-16/TAP-22; reviewer runs `npm test` and inspects mocked `ctx.ui.notify()` payloads. |
| `interactive-mockup.html::renderList()` | Boot validation summary in list info line | required | `/model-groups` list includes current boot validation summary with unavailable and project override counts. | S3 | A3 | TAP-11; reviewer runs `npm test`. |
| `interactive-mockup.html::commandRows()` superseded command label plus Pi `registerCommand`/`ctx.ui.custom()` source | Slash command entry | required | Pi command is `/model-groups`; `registerModelGroupsCommand` registers it, `index.ts` calls that registration, and the command handler opens the custom component via `ctx.ui.custom()` with live `ctx.modelRegistry` and `ctx.cwd`. `/agent`/"Agent Groups" labels are not accepted. | S4 | A4 | TAP-24; reviewer runs `npm test`. |
| `interactive-mockup.html::renderList()` | Group rows with health tags | required | Merged list rows show degraded ⚠, unavailable ✗, and project override health tags when those states apply. | S5 | A5 | TAP-11; reviewer runs `npm test`. |
| `interactive-mockup.html::renderList()` | Final `+ Add group` row, no Validate row | required | `+ Add group` is the final navigable row; no Validate row/action is rendered or reachable. | S6 | A6 | TAP-11; reviewer runs `npm test`. |
| Pi theme docs + `theme.js::getSelectListTheme()` + built-in `dark.json` | Selected option highlight | required | Selected row/option markers and primary labels use Pi `accent` foreground (`theme.fg("accent", ...)`, current built-in dark `#8abeb7`) rather than bespoke plugin colors; descriptions and secondary metadata may remain muted. | S24 | A24 | TAP-27; reviewer runs `npm test`. |
| `interactive-mockup.html::goAddDraft()/uniqueGroupName()` | Add-group auto-name behavior | required | Selecting `+ Add group` computes `new-group`, then `new-group-N`, before calling strict `createGroup`; created group is project-scoped with `models: []`. | S7 | A7 | TAP-17 and TAP-02; reviewer runs `npm test`. |
| `interactive-mockup.html::renderEditorBase()` plus Pi input source | Editor name input immediate apply | required | Name row is text-entry capable; row change, Enter, or Esc commits the pending name through `renameGroup` before leaving the edit context. | S8 | A8 | TAP-18 and TAP-03; reviewer runs `npm test`. |
| `interactive-mockup.html::renderEditorBase()` | Editor Location selector | required | Project/global Location rows switch scope by invoking `moveGroup(cwd, name, newScope)` and reflect target scope only after successful move. | S9 | A9 | TAP-19 and TAP-04; reviewer runs `npm test`. |
| `interactive-mockup.html` wizard screens superseded by story override plus manual feedback FB-002 | Provider → model → thinking wizard | required | Wizard has exactly three steps with visible Step 1/3, 2/3, 3/3-equivalent copy; model choices are limited to models authorized via `ModelRegistry.hasConfiguredAuth(model)`; no review/fourth step ships; Enter on Step 3 persists the added model through `updateGroup` before returning to the editor. | S10 | A10 | TAP-13/TAP-25; reviewer runs `npm test`. |
| Manual feedback FB-001 plus Pi `Component.handleInput(data: string)` source | Wizard Esc/left-arrow back behavior | required | In wizard screens, Esc and ← share the same back-step behavior: thinking → model, model → provider, and provider → editor. | S23 | A23 | TAP-26; reviewer runs `npm test`. |
| `interactive-mockup.html::renderModelEdit()` | Model edit info display | required | Model edit screen displays provider, modelId, and available/unavailable status. | S11 | A11 | TAP-14; reviewer runs `npm test`. |
| `interactive-mockup.html::renderModelEdit()` plus `getSupportedThinkingLevels()` source | Thinking options | required | Thinking list always includes inherit and otherwise only levels supported by the selected model; static mockup list is superseded. | S12 | A12 | TAP-14; reviewer runs `npm test`. |
| `interactive-mockup.html::activate()` MODEL_EDIT | Immediate thinking apply | required | Selecting a thinking level and pressing Enter immediately persists the updated model entry through `updateGroup`; persistence errors notify and keep last confirmed visible state. | S13 | A13 | TAP-14/TAP-25; reviewer runs `npm test`. |
| `interactive-mockup.html` footer/key handler intent plus Pi input source | Model edit `D` remove | required | `D` on MODEL_EDIT removes the selected model through `updateGroup` and returns to editor after success when no text input is active; persistence errors notify and keep the model visible. | S14 | A14 | TAP-12/TAP-25; reviewer runs `npm test`. |
| `interactive-mockup.html::renderDelete()` | Delete confirmation and override warning | required | LIST `D` opens confirmation with group summary; same-name other-scope group warning is visible; confirmed Delete removes only selected scope. | S15 | A15 | TAP-20 and TAP-06; reviewer runs `npm test`. |
| `interactive-mockup.html` delete-while-typing intent plus Pi `Component.handleInput(data: string)`/`Input.focused` source | Delete key text-input guard | required | Delete action only fires on LIST or MODEL_EDIT when component state says no text input is active; focused Pi/custom text entry receives literal `d`. | S16 | A16 | TAP-12; reviewer runs `npm test`. |
| Grilled design Q19 | Rename collision rejection | required | Same-scope rename collision leaves old group unchanged and reports error via `ctx.ui.notify()`. | S17 | A17 | TAP-05 and TAP-18; reviewer runs `npm test`. |
| Grilled design Q23 | Scope move success/collision | required | `moveGroup` writes target/removes source on success and rejects target-scope same-name collisions; failure branches are bounded by A22. | S18 | A18 | TAP-04 and TAP-19; reviewer runs `npm test`. |
| Grilled design Q9 | Malformed JSON recovery | required | Malformed JSON is backed up to `.bak`, config is empty for that scope, and boot integration notifies. | S19 | A19 | TAP-07 and TAP-16; reviewer runs `npm test`. |
| Grilled design Q9 | Unknown future version recovery | required | Unsupported higher version refuses load, config is empty for that scope, and boot integration notifies. | S20 | A20 | TAP-08 and TAP-16; reviewer runs `npm test`. |
| Grilled design Q9 plus raw input boundary review | Schema-invalid JSON recovery | required | Parseable JSON with invalid `ModelGroupsConfig` shape is backed up to `.bak`, config is empty for that scope, a `schema-invalid` load issue is emitted, and boot integration notifies. | S21 | A21 | TAP-21 and TAP-16; reviewer runs `npm test`. |
| Filesystem persistence risk lens | Persistence failure notification | required | Backup/write/rename/delete failures are reported with operation/scope/path details; UI stays on last confirmed state unless a target-written/source-retained partial move is explicitly reported for retry. | S22 | A22 | TAP-22/TAP-23; reviewer runs `npm test`. |

Orientation-only mockup behavior (for example S26 arrow clamping and non-wizard Esc navigation) may guide implementation and is covered by TAP-11 where cheap, but it is not an independent design obligation unless promoted to acceptance in a later story.

### Input Boundary Shape Risk

| Boundary / Shape | In-Scope Cases | Required Handling | Proof |
|---|---|---|---|
| Raw persisted JSON parse | Missing file; malformed JSON | Missing file returns empty config with no issue. Malformed JSON backs up to `.bak`, returns empty config for that scope, emits `corrupt-json`, and notifies through boot integration. | TAP-07, TAP-16 |
| Raw persisted JSON schema | Wrong root shape; missing/non-string `provider` or `modelId`; non-array `models`; invalid `thinkingLevel` value | Parseable but invalid shape backs up to `.bak`, returns empty config for that scope, emits `schema-invalid`, and notifies through boot integration. | TAP-21, TAP-16 |
| Forward compatibility | Version higher than current | Refuse to load that scope, return empty config with unsupported-version issue, and notify. | TAP-08, TAP-16 |
| Recovery backup failure | `.bak` copy/rename denied or fails | Do not overwrite/delete the original file; return empty config only for current in-memory load; include backup-failure detail in the load issue and notify; later CRUD reloads in that scope must refuse to save over the unrecovered file with a typed `load-recovery` error. | TAP-22, TAP-16 |
| Persistence writes/moves/deletes | Access denied, temp write failure, rename failure, source removal failure during cross-scope move | Throw typed operation/scope/path/phase details; keep existing committed config unchanged where the failed phase occurs before commit; do not update TUI visible state as saved/moved until success; report target-written/source-retained partial moves for operator retry. | TAP-23 |

### Risk Lens Inventory

| Risk Lens | Disposition | Coverage / Exclusion |
|---|---|---|
| Raw persisted input boundary | Active | A19/A20/A21 and TAP-07/TAP-08/TAP-21 cover malformed JSON, unsupported versions, and schema-invalid but parseable configs. |
| Filesystem I/O / permissions | Active | A22 and TAP-22/TAP-23 cover backup, access-denied, temp write, rename, delete/source-removal, and partial move reporting. |
| Persistence durability | Active | Per-file writes use temp file + rename; cross-scope move is bounded as target-first with source retained on partial failure rather than silently claiming success. |
| ModelRegistry authorization/API boundary | Active | A1 validates persisted refs with `hasConfiguredAuth()` and A10/TAP-13 require the add-model picker to exclude unauthorized models before selection. |
| TUI keyboard interaction semantics | Active | A23/TAP-26 require Esc and ← to share wizard back-step behavior while TAP-11 preserves non-wizard Esc/back navigation. |
| Theme consistency / design-token drift | Active | A24/TAP-27 require selected option styling to use Pi's `accent` token (current built-in dark `#8abeb7`) rather than a bespoke plugin color. |
| Concurrency / external edits | Explicitly excluded from this story beyond last-write-wins per operation | No cross-process file locking or conflict UI is required; future routing stories may add stronger coordination if needed. |

## Critical Files

**New:**

| File | Role |
|------|------|
| `model-groups/types.ts` | Data model types: `ModelGroupsConfig`, `ModelGroupDef`, `ModelGroupModel`, `ModelGroupValidation`, `ResolvedModelGroup`, `ModelGroupScope`, `ModelGroupsLoadIssue`, `ModelGroupsPersistenceError`, `ModelGroupsLoadResult`, `ModelGroupsBootValidation` |
| `model-groups/store.ts` | CRUD service: `loadModelGroups(cwd)` returning config plus load issues, `saveModelGroups(scope, cwd, config)`, `listResolvedModelGroups(cwd, modelRegistry)`, `createGroup(scope, cwd, name, def)`, `updateGroup(scope, cwd, name, def)`, `renameGroup(scope, cwd, oldName, newName)`, `deleteGroup(scope, cwd, name)`, `moveGroup(cwd, name, newScope)`, `validateModelGroups(loadResult, modelRegistry)`, typed filesystem failure reporting |
| `model-groups/tui.ts` | Custom TUI component: internal state machine (LIST, EDITOR, MODEL_EDIT, WIZARD_PROVIDER, WIZARD_MODEL, WIZARD_THINKING, DELETE_CONFIRM), Pi-native active input/focus state, `+ Add group` unique-name helper, `handleInput()` with D delete guard, `render()` dispatching per screen |
| `model-groups/command.ts` | `/model-groups` command handler: `registerModelGroupsCommand(pi, state)` registers `model-groups`, invokes `ctx.ui.custom()`, and passes `ctx.modelRegistry` plus `ctx.cwd` into the TUI component |
| `tests/unit/model-groups-crud.test.ts` | Data layer unit tests (TAP-01 through TAP-10, TAP-21 through TAP-23) |
| `tests/unit/model-groups-tui.test.ts` | TUI unit tests (TAP-11 through TAP-14, TAP-17 through TAP-20, TAP-23, TAP-25, TAP-26, TAP-27) |
| `tests/unit/model-groups-integration.test.ts` | Extension integration unit tests for boot `session_start` validation and load-issue notifications (TAP-16) |

**Modified:**

| File | Change |
|------|--------|
| `index.ts` | Import and call `registerModelGroupsCommand(pi, state)`, add boot validation logic in `session_start` handler |
| `state.ts` | Add `modelGroups: { groups: ResolvedModelGroup[]; validation: ModelGroupsBootValidation \| null }` to `AgenticodingState` |

## Implementation Notes

**Source-inspection focus:** The `/notebook` command in `index.ts` is the closest existing reference — it uses `ctx.ui.custom()` with `Container`, `SelectList`, `Text`, and `DynamicBorder`, manages internal state with a `selectList` reference and `finished` flag, and handles input dispatching. The `handleInput` pattern (guard `finished`, forward to child component, call `tui.requestRender()`) should be reused.

**Smallest red-first seam:** `model-groups/store.ts` → `loadModelGroups()` + `saveModelGroups()`. Write a unit test that creates a temp file, writes a minimal config, reads it back, and asserts equality. This verifies the persistence layer independently of TUI. Then `validateModelGroups()` against a mock `ModelRegistry` — proves the validation pipeline before any UI exists.

**Phases:**
1. **Data layer** — types + store + validation. Red-first: `loadModelGroups` returns empty configs plus no issues from missing files. Green: read/write round-trip. Red: malformed JSON → backup + empty + `ModelGroupsLoadIssue`. Green: `.bak` created, empty config returned, issue includes scope/path/kind. Red: parseable schema-invalid JSON → backup + empty + `schema-invalid` issue. Green: wrong root and wrong model-entry shapes are rejected. Red: unknown version → refuse + `ModelGroupsLoadIssue`. Green: version 99 rejected with issue. Red: backup/temp-write/rename/source-removal failure. Green: original committed file is not silently overwritten, typed error/load issue includes operation/scope/path/phase, and callers can notify.
2. **TUI list + editor** — command registration + list screen + group editor. Red-first: `/model-groups` opens empty list and selected rows/options use Pi `accent` styling. Green: shows groups from config with selected markers/primary labels styled via `theme.fg("accent", ...)` (current built-in dark `#8abeb7`). Red: Enter on `+ Add group` computes the next available `new-group`/`new-group-N` name before calling `createGroup`; editor name row-change calls `renameGroup`; Location row calls `moveGroup`. Green: project-scoped empty group appears in list, editor opens, immediate actions persist through mocked store calls.
3. **Model wizard + model edit** — add-model flow + model edit screen. Red-first: wizard step 1 renders provider list from mock registry, Step 2 excludes unauthorized models using `hasConfiguredAuth(model)`, and Esc/← take identical wizard back steps. Green: 3-step flow adds an authorized model to group and keyboard back behavior matches the contract.
4. **Delete + move** — delete confirmation + scope move. Red-first: D on group opens confirm. Green: confirm calls `deleteGroup` and returns to refreshed list. Red: moveGroup rejects collision. Green: scope switch moves successfully and TUI reports collision without changing scope. Red: target write/source removal failure. Green: source is not deleted before target write success, partial target-written/source-retained state is reported for retry, and TUI does not claim an unconfirmed move.
5. **Boot validation integration** — wire `session_start` in `index.ts`. Red-first: validation result and store load issues show in `ctx.ui.notify()`. Green: notification + list info line populated; malformed/schema-invalid/unsupported-version load issues and backup-failure detail produce operator-visible warnings.

**Known constraints:**
- `ModelRegistry` is only available via `ctx.modelRegistry` during command/session handlers — factory-time state cannot hold it. The TUI must receive it from the command handler context.
- Store code must stay UI-free: corrupt/schema-invalid/unsupported-version loads return `ModelGroupsLoadIssue` values, write/delete/move failures throw typed `ModelGroupsPersistenceError` details, and `index.ts`/command/TUI integration owns translating those issues/errors to `ctx.ui.notify()`.
- Pi TUI components (`SelectList`, `SettingsList`) use Pi's theme system — mockup colors need mapping to Pi theme tokens.
- `pi.registerCommand("model-groups", ...)` is in a clean namespace (no built-in collision).
- File I/O uses `node:fs` — the plugin already imports `node:path` in notebook modules.

**Red-first infeasibility:** None. All seams are independently testable.

## Locked Decisions

| Decision | Choice | Rejected alternative |
|----------|--------|---------------------|
| Feature label / command | "Model Groups" / `/model-groups` | "Agent Groups" / `/agent` (original mockup label) |
| Selected option styling | Pi standard selected-option accent foreground via `theme.fg("accent", ...)`; current built-in dark accent is `#8abeb7` | Bespoke plugin colors or hardcoded selected-option styling that drifts from Pi |
| Delivery | Inside `pi-agenticoding` plugin as new `model-groups/` module | Separate extension or core Pi contribution |
| Persistence | Self-managed JSON files (`~/.pi/agent/pi-agenticoding/model-groups.json` + `<cwd>/.pi/pi-agenticoding/model-groups.json`) | `SettingsManager` (not accessible from extensions) or session-embedded via `pi.appendEntry()` (per-session, not cross-session) |
| Data model scope | Group-level CRUD only; `{ provider, modelId, thinkingLevel? }` per model entry | Per-model CRUD operations at service layer (array-index fragility) or per-group thinking level (mockup uses per-model) |
| thinkingLevel absent | Absent field = inherit | `"inherit"` as explicit string value (mismatch with Pi's native `ModelThinkingLevel`) |
| Group operations | `createGroup` / `updateGroup` / `renameGroup` / `deleteGroup` / `moveGroup` (separate, explicit) | `upsertGroup` (silent overwrite ambiguity) |
| Validation timing | Boot-only, on `session_start` | Per-mutation re-validation (no Pi model-degradation events exist to subscribe to) |
| Validation hooks | Own layer on top of `modelRegistry.find()` + `hasConfiguredAuth()`; no Pi hooks exist | N/A — Pi has zero model validation infrastructure |
| Delete key | `D` in-component, guarded by the Pi component's active input/focus state; `Delete` as unadvertised fallback | DOM `[data-input]` selectors from the mockup, `pi.registerShortcut("shift+d", ...)` (global, needs guard), or configurable keybinding ID (not available to extensions) |
| Wizard back keys | Esc and ← share the same add-model wizard back-step behavior (thinking → model, model → provider, provider → editor) | Esc jumping directly out of the wizard while ← steps back one wizard screen |
| Model picker data | Live `ModelRegistry` (`getAll()`, `getAvailable()`) filtered by `hasConfiguredAuth(model)` for add-model choices | Hardcoded static lists or showing unauthorized models in the selectable picker |
| Thinking filtering | `getSupportedThinkingLevels()` per model at picker render time | Static list of all levels regardless of model capability |
| Empty groups | Allowed | Enforced minimum 1 model (breaks immediate-create-then-edit flow) |
| Scope delete behavior | Delete global, keep project, warn | Delete both (surprising project-local data loss) or block delete (hostile UX) |
| Add-group naming ownership | LIST `+ Add group` flow in the TUI/command layer computes `new-group`, then `new-group-N`, before calling `createGroup` | `createGroup` silently auto-renaming or overwriting, which would hide collision ownership in the store |
| Rename/create collision | Store functions reject same-scope collision with notification/error | Silent overwrite or store-level auto-rename |
| Load error notification ownership | Store returns `ModelGroupsLoadIssue` for corrupt/schema/unsupported-version files; `index.ts` `session_start` and command/TUI adapters translate issues to `ctx.ui.notify()` | Passing `ctx.ui` into store functions (couples data layer to UI) or store silently swallowing recovery details |
| Corrupt/schema-invalid file recovery | Backup to `.bak` + reset to empty + `ModelGroupsLoadIssue`, then caller notifies via `ctx.ui.notify()` | Silent reset (data loss without visibility), store-level UI dependency, or block startup (too aggressive) |
| Filesystem failure model | Backup failure keeps original file untouched and reports detail; save/delete/move failures throw typed operation/scope/path/phase errors; TUI/boot adapters notify and keep visible state on last confirmed data; cross-scope move is target-first and reports target-written/source-retained partial failures for retry | Silent data loss, pretending a failed write/move succeeded, or requiring full cross-file transaction/locking in this CRUD story |
| TUI registration | Single `/model-groups` command, internal state machine | Multiple commands per screen (cluttered autocomplete, context-passing between custom() calls) |
| TUI components | Delegate to `SelectList` for lists/wizard, custom for editor screen | All-custom rendering or all-`SettingsList` (can't handle mixed row types) |

## Discovery Notes

- **Pi has zero model validation hooks or infrastructure.** No `before_model_select`, no validation middleware, no model-health abstraction. `model_select` event is post-facto notification only. Implementation must build its own validation layer.
- **`SettingsManager` is exported but unreachable from extension context.** The type is publicly exported from `@earendil-works/pi-coding-agent`, but `ExtensionContext` and `ExtensionAPI` have no `settingsManager` property. An extension could construct its own instance but it would be separate from the session's live one.
- **The plugin's existing notebook persistence uses `pi.appendEntry()`, not filesystem.** Notebook data is embedded in session JSONL files. This pattern is session-scoped, not suitable for cross-session model group config.
- **`ctx.modelRegistry` is available in command handlers and event handlers.** Exposes `find(provider, id)`, `getAll()`, `getAvailable()`, and `hasConfiguredAuth(model)`. Synchronous in-memory lookups.
- **Pi's current selected-option mint color is the theme `accent` token, not a separate hardcoded color.** `docs/themes.md` says `accent` is for selected items; `theme.js::getSelectListTheme()` applies `theme.fg("accent", ...)` to selected prefix/text; built-in `dark.json` resolves `accent` to `#8abeb7` (RGB 138,190,183). Use the token in implementation and cite the hex only as the discovered current built-in-dark value.
- **`/model-groups` namespace is clean — no built-in Pi command collision.** Pi's built-in slash commands do not include `model-groups`.
- **The existing `/notebook` command in `index.ts` is the closest TUI reference.** Uses `ctx.ui.custom()` with `Container`, `SelectList`, `Text`, `DynamicBorder`; `handleInput` dispatches to child component; calls `tui.requestRender()` after input.
- **Plugin test pattern:** `npm test` runs `node ./scripts/run-node-test.mjs tests/unit/**/*.test.ts` from `pi-agenticoding/package.json`. Focused model-groups runs should call `node ./scripts/run-node-test.mjs tests/unit/model-groups-crud.test.ts tests/unit/model-groups-tui.test.ts tests/unit/model-groups-integration.test.ts` from the plugin root. Tests import from `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`.
- **Notification ownership seam:** `model-groups/store.ts` should report corrupt/schema/unsupported-version loads as typed `ModelGroupsLoadIssue` values; extension/TUI integration owns `ctx.ui.notify()` so data-layer tests can assert recovery without mocking Pi UI and integration tests can assert operator-visible notifications.
- **Persistence failure seam:** Filesystem backup/write/rename/delete failures are store-level typed errors or load-issue details, not UI dependencies. Tests must assert original committed files/state are not silently overwritten and UI adapters notify while keeping visible state on last confirmed data.

## Feedback Absorption Log

- FB-001: amended `Scenarios / Behavior Examples`, `Acceptance`, `Verification`, `Design Sources`, `Design Element Trace`, `Risk Lens Inventory`, `Implementation Notes`, and `Locked Decisions` from manual:20260614-model-groups-feedback-1. See epic log.
- FB-002: amended `Scope`, `Scenarios / Behavior Examples`, `Acceptance`, `Verification`, `Design Sources`, `Design Element Trace`, `Risk Lens Inventory`, `Implementation Notes`, and `Locked Decisions` from manual:20260614-model-groups-feedback-2. See epic log.
- FB-003: amended `Scenarios / Behavior Examples`, `Acceptance`, `Verification`, `Design Sources`, `Design Element Trace`, `Risk Lens Inventory`, `Implementation Notes`, `Locked Decisions`, and `Discovery Notes` from manual:20260615-selected-option-mint-highlight. See epic log.
- Lifecycle reopen 2026-06-15T07:30:55Z: operator explicitly reopened the completed story from `✅ DONE` to `🔄 IN PROGRESS` so FB-001/FB-002/FB-003 amendments can receive fresh `/openspec-story-plan-review` before implementation resumes. Plan remains `🟠 PLAN CHANGES REQUESTED`; product code unchanged by this reopen.
- Feedback implementation 2026-06-15T07:44:14Z: FB-001/FB-002/FB-003 amendments implemented in `pi-agenticoding/model-groups/tui.ts` and proven by `tests/unit/model-groups-tui.test.ts`; focused model-groups, typecheck, and full unit suite passed. Status moved to `🟣 IN REVIEW` for fresh implementation review.

## Plan Review Log

- 2026-06-14T13:15:44Z Prior plan review history compressed by `/openspec-story-plan-resume`
  - Original plan review entries addressed: 2026-06-14T12:34:26Z, 2026-06-14T12:43:01Z, 2026-06-14T13:13:04Z
  - Latest prior lane transition: 🟠 PLAN CHANGES REQUESTED -> 🟡 PLAN DRAFT
  - Changes preserved: store/UI notification ownership through typed `ModelGroupsLoadIssue`; TUI callsite proof for editor rename, Location move, and list delete confirmation; schema-invalid persisted-config proof (S21/A21/TAP-21); bounded filesystem backup/write/rename/delete/move failure proof (S22/A22/TAP-22/TAP-23); raw input and filesystem risk-lens matrices with explicit concurrency/locking exclusion.
  - Material evidence anchors preserved: repo test lane (`pi-agenticoding/package.json`, `scripts/run-node-test.mjs`), Pi TUI `handleInput(data: string)`/focus APIs, `ModelRegistry` APIs, `ctx.ui.notify()`, mockup visible-screen anchors, `design.md` data model/persistence/CRUD sections, and `tasks.md` data-layer/proof checklists.
  - Debt Friction retained/resolved in plan: stale harness/DOM assumptions, helper-only UI proofs, ambiguous notification ownership, schema-invalid proof, and filesystem failure proof were converted to explicit verification obligations; no unresolved blockers remain from these entries.

- 2026-06-14T13:24:44Z Plan feedback addressed by `/openspec-story-plan-resume`
  - Original plan review entry: 2026-06-14T13:22:18Z
  - Sections edited: Scenarios / Behavior Examples, Acceptance, Verification Test Architecture Plan, Acceptance Proof Matrix, Surface / Branch Proof Matrix, Design Element Trace, Critical Files, supporting artifacts (`design.md`, `tasks.md`)
  - Plan lane transition: 🟠 PLAN CHANGES REQUESTED -> 🟡 PLAN DRAFT
  - Changes: Added TAP-24 and proof-matrix/branch/design-trace coverage for `registerModelGroupsCommand`, `/model-groups` registration, `ctx.ui.custom()`, and `ctx.modelRegistry`/`ctx.cwd` wiring. Added TAP-25 and A10/A13/A14 proof coverage for add-model, thinking-change, and model-remove paths calling `updateGroup`, refreshing only after success, and notifying/preserving last confirmed visible state on persistence errors. Synchronized `design.md` command-adapter and immediate-apply sections plus `tasks.md` verification checklist.
  - Original key findings compressed: 2026-06-14T13:22:18Z requested command-adapter proof for A4 and model-entry immediate-persistence proof for A10/A13/A14 through `updateGroup`; prior schema-invalid and filesystem-failure blockers remained resolved.
  - Debt Friction: none

- 2026-06-14T13:30:23Z Plan review run by fresh maintainer session
  - Verdict: approve
  - Plan lane transition: 🟡 PLAN DRAFT -> 🟣 PLAN IN REVIEW -> 🟢 PLAN APPROVED
  - Status transition: unchanged: absent -> absent
  - Sections reviewed: Purpose, Actors, Triggering Need, Expected Prerequisites, Scope, Out of Scope, Scenarios / Behavior Examples, Acceptance, Verification, Critical Files, Implementation Notes, Locked Decisions, Discovery Notes
  - Original intent checked: initiative/proposal (`openspec/initiatives/model-tag-router/initiative.md`, `openspec/changes/model-groups-data-layer-tui/proposal.md`), normative mockup source anchors, Pi TUI/extension/model source anchors; no linked GitHub/Jira ticket found
  - Traceability: forward complete; backward complete
  - Design trace: complete
  - Code surfaces searched: `pi-agenticoding/index.ts`, `pi-agenticoding/state.ts`, `pi-agenticoding/package.json`, `pi-agenticoding/scripts/run-node-test.mjs`, `pi-agenticoding/tests/unit/*.test.ts`, `pi/packages/tui/src/tui.ts`, `pi/packages/tui/src/components/input.ts`, `pi/packages/coding-agent/src/core/extensions/types.ts`, `pi/packages/coding-agent/src/core/model-registry.ts`, `pi/packages/ai/src/models.ts`, mockup visible/key-handler anchors
  - Risk lenses reviewed: raw persisted input boundary, filesystem I/O/permissions, persistence durability, prompt/template fail-open not material, concurrency/external edits explicitly excluded beyond last-write-wins per operation
  - Evidence quality: confirmed Plan contract sections, Pi API/test-lane anchors, acceptance/proof coverage, and prior blocker absorption; inferred none material; unknown no external ticket/Jira beyond initiative sources; provisional manual visual smoke for rendered tags/info line is bounded by unit data-path proof
  - Finding closure: prior request_changes hotspots (notification ownership, schema-invalid persisted config, filesystem failure modes, command-adapter proof, model-entry immediate persistence proof) are represented in scenarios/acceptance/TAP/proof/design/tasks with direct anchors; no unresolved request_changes entries remain
  - Key findings:
    - No blocking findings. The story is atomic for CRUD/data-layer/TUI setup and keeps spawn/routing/meta-model behavior out of scope.
    - Acceptance A1-A22 all have proof-matrix coverage, normative S1-S22 each map to a single acceptance id, and TAP-01 through TAP-25 name owning files, seams, commands, fixture strategy, and fallback paths.
    - Activated raw-input and filesystem/persistence risk lenses are covered by A19-A22, TAP-07/TAP-08/TAP-16/TAP-21/TAP-22/TAP-23, Input Boundary Shape Risk, and Risk Lens Inventory.
  - Hypothesis triage: none
  - Debt Friction: none
  - Next action: Run `/openspec-story-claim model-tag-router model-groups-data-layer-tui` from a fresh session.

- 2026-06-15T07:34:44Z Plan review run by fresh maintainer session
  - Verdict: approve
  - Plan lane transition: 🟠 PLAN CHANGES REQUESTED -> 🟣 PLAN IN REVIEW -> 🟢 PLAN APPROVED
  - Status transition: unchanged: 🔄 IN PROGRESS -> 🔄 IN PROGRESS
  - Sections reviewed: Purpose, Actors, Triggering Need, Expected Prerequisites, Scope, Out of Scope, Scenarios / Behavior Examples, Acceptance, Verification, Critical Files, Implementation Notes, Locked Decisions, Discovery Notes
  - Original intent checked: initiative/proposal/design (`openspec/initiatives/model-tag-router/initiative.md`, `openspec/changes/model-groups-data-layer-tui/proposal.md`, `openspec/changes/model-groups-data-layer-tui/design.md`), story feedback absorption log/manual FB IDs, lifecycle progress/review logs for reopen context; no linked GitHub/Jira/PR source found
  - Traceability: forward complete; backward complete
  - Design trace: complete
  - Code surfaces searched: `pi-agenticoding/model-groups/{types,store,tui,command}.ts`, `pi-agenticoding/{index.ts,state.ts,package.json}`, `pi-agenticoding/tests/unit/model-groups-*.test.ts`, Pi `ModelRegistry`, Pi TUI `Component.handleInput`/`Input.focused`, `getSupportedThinkingLevels`, Pi theme `getSelectListTheme()`/`getSettingsListTheme()`/built-in dark `accent`, mockup visible/key-handler anchors
  - Risk lenses reviewed: ModelRegistry authorization/API boundary, Pi TUI keyboard/focus semantics, theme token/design-token drift, raw persisted input boundary, filesystem I/O/permissions, persistence durability; concurrency/external edits remain explicitly excluded beyond last-write-wins per operation
  - Evidence quality: confirmed FB-001/FB-002/FB-003 amendments are represented in scenarios, acceptance, TAP/proof rows, design sources/trace, implementation notes, locked decisions, tasks, and directly matching Pi API/theme anchors; inferred none material; unknown no external ticket/Jira beyond manual feedback IDs and initiative sources; provisional implementation completeness intentionally not assessed in contract-review mode
  - Finding closure: the amended plan maps FB-001 Esc/← wizard parity to S23/A23/TAP-26, FB-002 authorized-only add-model choices to S10/A10/TAP-13/TAP-25, and FB-003 selected-option accent styling to S24/A24/TAP-27 with source-backed Pi accent anchors (`theme.fg("accent", ...)`, current dark `#8abeb7`). Product code is still pending implementation for these amendments, but `tasks.md` records the concrete implementation/test/run checklist and the plan names the owning TUI/test surfaces.
  - Key findings:
    - No blocking findings. The reopened feedback is fully represented in the planning contract and proof plan with atomic acceptance ids and reviewer-runnable test rows.
    - No initiative drift found: the story remains CRUD-only, preserves spawn/routing/meta-model exclusions, and keeps persistence/validation ownership inside `pi-agenticoding` as required by the initiative.
  - Hypothesis triage: current product TUI surfaces (`modelsForProvider`, wizard back handling, selected-row rendering) are known implementation targets for the feedback amendments; proof targets are explicit in TAP-13, TAP-26, TAP-27, so no plan failure remains.
  - Debt Friction: none
  - Next action: Run `/openspec-story-resume model-tag-router model-groups-data-layer-tui` from a fresh session to implement the approved feedback amendments.
