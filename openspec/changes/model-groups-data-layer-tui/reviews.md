# Review Log

- 2026-06-14T14:57:37Z Review run by fresh maintainer session
  - Decision: request_changes
  - Approval gate: fail
  - Product verdict: request_changes
  - Technical verdict: request_changes
  - Multipass review: completed
  - Prior review concerns: none
  - Plan lane at review time: 🟢 PLAN APPROVED
  - Initiative contract drift: none
  - Status transition: 🟣 IN REVIEW -> 🔄 IN PROGRESS
  - Sections reviewed: Purpose, Actors, Triggering Need, Expected Prerequisites, Scope, Out of Scope, Scenarios / Behavior Examples, Acceptance, Verification, Critical Files, Implementation Notes, Locked Decisions, Discovery Notes
  - Original intent checked: initiative.md, proposal.md, design.md, progress.md; no linked GitHub/Jira/PR source found
  - Traceability: forward gaps; backward gaps
  - Design trace: gaps; rendered evidence: gaps
  - Code surfaces searched: `pi-agenticoding/model-groups/*`, `pi-agenticoding/index.ts`, `pi-agenticoding/state.ts`, `pi-agenticoding/tests/unit/model-groups-*.test.ts`, `CHANGELOG.md`, targeted searches for `modelGroups`, `model-groups`, `spawn`, `handoff`, `notebook`, `ctx.ui.custom`, `session_start`, `activeTextInput`, `deleteGroup`
  - Risk lenses reviewed: raw persisted input, filesystem I/O/permissions, persistence durability, Pi TUI input/focus routing, command/session integration; concurrency/external edits excluded by story beyond last-write-wins per operation
  - Finding closure: first implementation review; no prior implementation findings
  - Evidence quality: confirmed direct source/test/story inspection plus focused-pass test reruns and an ad-hoc temp backup-failure reproduction; inferred live Pi rendering from custom component strings; unknown live Pi dev-session smoke; provisional proof rows remain for A3/A5
  - Files reviewed: `openspec/initiatives/model-tag-router/initiative.md`, `openspec/changes/model-groups-data-layer-tui/{story.md,proposal.md,design.md,tasks.md,progress.md}`, `pi-agenticoding/{CHANGELOG.md,index.ts,state.ts,package.json}`, `pi-agenticoding/model-groups/{types.ts,store.ts,tui.ts,command.ts}`, `pi-agenticoding/tests/unit/model-groups-{crud,tui,integration}.test.ts`
  - Hypothesis triage:
    - suspicious surface: `model-groups/store.ts` raw load -> CRUD save flow; tentative issue: backup-failure recovery can be overwritten by later mutators; next proof target: `loadScopeConfig()` and `createGroup()` temp reproduction
    - suspicious surface: `model-groups/tui.ts` group-name active input; tentative issue: row-change does not commit pending rename; next proof target: `handleInput()` active branch vs Up/Down navigation
    - suspicious surface: final TAP/proof matrix; tentative issue: proof rows overclaim completed final coverage; next proof target: A3/A5 provisional rows, unchecked manual smoke, and TAP-20 TUI test body
  - Key findings:
    - A22 is not satisfied: a corrupt/schema-invalid config whose `.bak` copy fails can later be silently overwritten by CRUD mutators because `loadScopeConfig()` drops the load issue and returns the empty in-memory config to `createGroup()`/other mutators. Sources: `pi-agenticoding/model-groups/store.ts:79`, `pi-agenticoding/model-groups/store.ts:166`, `pi-agenticoding/model-groups/store.ts:174`, `openspec/changes/model-groups-data-layer-tui/story.md:107`

      <details open>
      <summary><b>High</b> severity · <b>High</b> likelihood</summary>

      **Why:** The story explicitly requires backup failure to leave the original file untouched and use the empty config only for the current in-memory load. The implementation preserves the file during `loadModelGroups()`, but a later CRUD operation reloads the same broken file as empty and writes a new valid config over it, which silently drops the user's original invalid-but-recoverable data.

      **Assumptions / Preconditions:** A project/global `model-groups.json` is corrupt or schema-invalid and `.bak` creation fails, then the operator performs a CRUD action in that same scope before manually resolving the file.

      **Downgrade Factors:** If the intended contract is revised to permit replacing unrecoverable corrupt configs on the next mutation, this would become a planning-contract change rather than an implementation defect.

      **Code Trail:** `backupAndIssue()` marks `backupFailed`, `loadScope()` returns an empty config plus issue, but `loadScopeConfig()` discards the issue and mutators such as `createGroup()` save the empty-derived config back to the original path.

      **Reproduction:** In a temp project, write `{bad` to project `model-groups.json`, mock `copyFileSync` to throw, call `loadModelGroups(cwd)` then `createGroup("project", cwd, "new", { models: [] })`; the file changes from `{bad` to a new valid JSON config.

      </details>
    - A8/S8 is not satisfied: row-change while editing the group name does not flush the pending rename. Sources: `openspec/changes/model-groups-data-layer-tui/story.md:93`, `pi-agenticoding/model-groups/tui.ts:410`, `pi-agenticoding/model-groups/tui.ts:418`, `pi-agenticoding/tests/unit/model-groups-tui.test.ts:71`

      <details open>
      <summary><b>Medium</b> severity · <b>High</b> likelihood</summary>

      **Why:** The user-facing immediate-apply contract says name edits apply on row change, Enter, or Esc. While the custom name input is active, the handler consumes printable/backspace/Enter/Esc and returns before Up/Down row navigation is processed, so moving focus with arrows neither commits the name nor changes rows.

      **Assumptions / Preconditions:** The operator focuses the name row, edits text, then presses Up/Down expecting focus to move and the rename to apply.

      **Downgrade Factors:** None for the current story wording; row-change is explicitly named in S8/A8/TAP-18.

      **Code Trail:** `handleInput()` enters the `activeTextInput === "group-name"` branch and returns before the `isUp`/`isDown` navigation branch, while the existing TUI test only exercises Enter commit and literal `d` typing.

      **Reproduction:** Open editor, focus Name, type a character, press Down; the handler remains in text-input mode and appends/ignores based on input handling instead of committing via `renameGroup()` before row navigation.

      </details>
    - Proof contract is still unresolved: A3/A5 remain `provisional` manual-smoke rows, the manual Pi smoke task is unchecked, and TAP-20 claims confirmed LIST delete proof that the inspected TUI test does not exercise. Sources: `openspec/changes/model-groups-data-layer-tui/story.md:163`, `openspec/changes/model-groups-data-layer-tui/story.md:165`, `openspec/changes/model-groups-data-layer-tui/tasks.md:75`, `openspec/changes/model-groups-data-layer-tui/tasks.md:84`, `pi-agenticoding/tests/unit/model-groups-tui.test.ts:39`

      <details open>
      <summary><b>Medium</b> severity · <b>High</b> likelihood</summary>

      **Why:** Approval requires final, matched proof for every acceptance item and required design row. The story still marks visible list summary/health-tag proof as provisional/manual, progress says live smoke remains, and the TAP-20 test opens delete confirmation but does not select “Delete group” and assert `deleteGroup()`.

      **Assumptions / Preconditions:** The proof matrix is intended to be the approval authority for this story, as specified in the review workflow.

      **Downgrade Factors:** Source inspection suggests the delete confirmation implementation has a reachable `deleteGroup()` path, so the A15 problem is a proof/test mismatch rather than a confirmed product-code absence.

      **Code Trail:** A3/A5 proof rows remain `provisional`; tasks leave live smoke unchecked; the TAP-20 task is checked, but the test body stops after rendering the confirmation and warning.

      **Reproduction:** Inspect `tests/unit/model-groups-tui.test.ts` test starting at line 39: it presses `D` and asserts confirmation text/warning only; it does not move to row 1, press Enter, or assert a store `deleteGroup` call.

      </details>
  - Debt Friction: none
  - Next action: `/openspec-story-resume model-tag-router model-groups-data-layer-tui`

- 2026-06-14T15:16:10Z Review run by fresh maintainer session
  - Decision: request_changes
  - Approval gate: fail
  - Product verdict: request_changes
  - Technical verdict: request_changes
  - Multipass review: completed
  - Prior review concerns: resolved
  - Plan lane at review time: 🟢 PLAN APPROVED
  - Initiative contract drift: none
  - Status transition: 🟣 IN REVIEW -> 🔄 IN PROGRESS
  - Sections reviewed: Purpose, Actors, Triggering Need, Expected Prerequisites, Scope, Out of Scope, Scenarios / Behavior Examples, Acceptance, Verification, Critical Files, Implementation Notes, Locked Decisions, Discovery Notes
  - Original intent checked: initiative.md, proposal.md, design.md, progress.md, prior reviews; no linked GitHub/Jira/PR source found
  - Traceability: forward gaps; backward complete
  - Design trace: gaps; rendered evidence gaps
  - Code surfaces searched: `pi-agenticoding/model-groups/{types,store,tui,command}.ts`, `pi-agenticoding/{index.ts,state.ts,CHANGELOG.md,package.json}`, `pi-agenticoding/tests/unit/model-groups-*.test.ts`, targeted searches for `ModelGroupsPersistenceError`, `toPersistenceMessage`, `notifyError`, `temp-write`, `writeFileSync`, `renameSync`, `load-recovery`, `deleteGroup`, `schema-invalid`, `ctx.ui.notify`, `modelGroups`, `spawn`, and `routing`
  - Risk lenses reviewed: raw persisted input boundary, filesystem I/O/permissions, persistence durability, Pi TUI input/focus routing, command/session integration; concurrency/external edits excluded by story beyond last-write-wins per operation
  - Finding closure: prior A22 backup-failure overwrite guard resolved by `load-recovery` refusal plus regression test; prior A8 row-change rename resolved by active-input Up/Down commit plus test; prior A3/A5/TAP-20 proof drift resolved by final proof rows and TUI assertions, including confirmed `deleteGroup`; new A22 notification-detail and temp-write proof gaps remain
  - Evidence quality: confirmed direct source/story/test inspection, four focused multipass children, focused model-groups test rerun (11/11), `npx tsc --noEmit`, and `npm test` (171/171); inferred generic schema-invalid boot notification through shared load-issue loop plus store schema-invalid test; unknown live Pi dev-session smoke; provisional none in current proof rows, but TAP-23 temp-write branch lacks direct test proof
  - Files reviewed: `openspec/initiatives/model-tag-router/initiative.md`, `openspec/changes/model-groups-data-layer-tui/{story.md,proposal.md,design.md,tasks.md,progress.md,reviews.md}`, `pi-agenticoding/{CHANGELOG.md,index.ts,state.ts,package.json}`, `pi-agenticoding/model-groups/{types.ts,store.ts,tui.ts,command.ts}`, `pi-agenticoding/tests/unit/model-groups-{crud,tui,integration}.test.ts`, `pi-agenticoding/tests/unit/helpers.ts`, relevant Pi references for `ModelRegistry.hasConfiguredAuth()` and `getSupportedThinkingLevels()`
  - Hypothesis triage:
    - suspicious surface: `model-groups/tui.ts` persistence error formatting; tentative issue: A22 requires operator notifications with affected scope/path/operation but TUI drops typed path fields; next proof target: `toPersistenceMessage()` and `ModelGroupsPersistenceError` fields
    - suspicious surface: `tests/unit/model-groups-crud.test.ts` TAP-23 coverage; tentative issue: temp-write failure branch is named in final proof but no test injects `writeFileSync`/`mkdirSync` failure; next proof target: persistence-failure test body and `saveModelGroups()` temp-write catch
    - suspicious surface: prior A22 backup-failure recovery; tentative issue: later CRUD might overwrite unrecovered corrupt config; next proof target: `loadScopeConfig()` and CRUD regression test — resolved
    - suspicious surface: prior A8 row-change rename path; tentative issue: active name input might not commit on row navigation; next proof target: `handleInput()` active text branch and TUI test — resolved
  - Key findings:
    - A22 persistence-failure notifications do not include the affected file path even though typed errors carry it, so CRUD/save/delete/move failures reaching the TUI do not meet the scope/path/operation notification contract. Sources: `openspec/changes/model-groups-data-layer-tui/story.md:77`, `openspec/changes/model-groups-data-layer-tui/story.md:107`, `openspec/changes/model-groups-data-layer-tui/story.md:234`, `pi-agenticoding/model-groups/tui.ts:65`, `pi-agenticoding/model-groups/types.ts:54`

      <details open>
      <summary><b>Medium</b> severity · <b>High</b> likelihood</summary>

      **Why:** Operators need the exact affected file/scope/operation when persistence fails so they know which config to repair or retry. The store preserves `sourcePath`/`targetPath`, but the TUI notification string only reports operation, phase, and the shorter message.

      **Assumptions / Preconditions:** A `ModelGroupsPersistenceError` from create/update/rename/delete/move reaches the TUI mutation handlers.

      **Downgrade Factors:** Boot load-issue notifications already include `sourcePath`; this finding is about persistence errors formatted through the TUI path. If the story contract is relaxed to not require path in operator notifications, this becomes a contract change rather than an implementation defect.

      **Code Trail:** S22/A22 and the design trace require notifications with affected scope/path/operation. `ModelGroupsPersistenceError` stores path fields, but `toPersistenceMessage()` omits `sourcePath` and `targetPath`, and all TUI mutation catches call `notifyError()`.

      **Reproduction:** Mock any TUI store operation to throw `new ModelGroupsPersistenceError({ operation: "save", scope: "project", sourcePath: "/tmp/project/.pi/pi-agenticoding/model-groups.json", targetPath: "/tmp/project/.pi/pi-agenticoding/model-groups.json.tmp", phase: "temp-write", message: "denied" })`; the notification is shaped like `save failed at temp-write: denied` and does not name either path.

      </details>
    - TAP-23/A22 proof is incomplete for the named temp-write failure branch: the final proof row claims `saveModelGroups()` temp-write coverage, but the inspected persistence test exercises rename/delete/move/source-removal failures and not `mkdirSync`/`writeFileSync` temp-write failure. Sources: `openspec/changes/model-groups-data-layer-tui/story.md:153`, `openspec/changes/model-groups-data-layer-tui/story.md:182`, `openspec/changes/model-groups-data-layer-tui/story.md:246`, `pi-agenticoding/model-groups/store.ts:153`, `pi-agenticoding/tests/unit/model-groups-crud.test.ts:103`

      <details open>
      <summary><b>Medium</b> severity · <b>High</b> likelihood</summary>

      **Why:** Approval requires final proof for every named failure mode. Temp-write/access-denied failure is an explicit A22/TAP-23 branch, but no test currently forces that branch, so the proof matrix overstates completed automated coverage.

      **Assumptions / Preconditions:** TAP-23 remains the approval proof for A22 filesystem failure handling.

      **Downgrade Factors:** Source inspection shows `saveModelGroups()` has a typed `temp-write` catch, so this is a proof completeness gap rather than a confirmed absence of implementation logic.

      **Code Trail:** TAP-23 names `saveModelGroups()` temp write/rename and says committed files remain unchanged on temp-write/rename failure. The test beginning at `model-groups-crud.test.ts:103` mocks `renameSync` for save/delete/move failures and a second rename for source-removal partial move, while no assertion injects a `writeFileSync` or `mkdirSync` failure into the temp-write branch.

      **Reproduction:** Inspect the persistence-failure unit test body or add a failing `writeFileSync`/`mkdirSync` mock; the current suite has no expectation that exercises `ModelGroupsPersistenceError.phase === "temp-write"`.

      </details>
  - Debt Friction: none
  - Next action: `/openspec-story-resume model-tag-router model-groups-data-layer-tui`

- 2026-06-14T15:31:08Z Review run by fresh maintainer session
  - Decision: request_changes
  - Approval gate: fail
  - Product verdict: approve
  - Technical verdict: request_changes
  - Multipass review: completed
  - Prior review concerns: resolved
  - Plan lane at review time: 🟢 PLAN APPROVED
  - Initiative contract drift: none
  - Status transition: 🟣 IN REVIEW -> 🔄 IN PROGRESS
  - Sections reviewed: Purpose, Actors, Triggering Need, Expected Prerequisites, Scope, Out of Scope, Scenarios / Behavior Examples, Acceptance, Verification, Critical Files, Implementation Notes, Locked Decisions, Discovery Notes
  - Original intent checked: initiative.md, proposal.md, design.md, progress.md, prior reviews; no linked GitHub/Jira/PR source found
  - Traceability: forward gaps; backward complete
  - Design trace: gaps; rendered evidence gaps
  - Code surfaces searched: `pi-agenticoding/model-groups/{types,store,tui,command}.ts`, `pi-agenticoding/{index.ts,state.ts,CHANGELOG.md,package.json}`, `pi-agenticoding/tests/unit/model-groups-*.test.ts`, targeted searches for `TAP-16`, `TAP-24`, `ctx.ui.notify`, `registerModelGroupsCommand`, `ctx.ui.custom`, `ctx.modelRegistry`, `ctx.cwd`, `schema-invalid`, `backupFailed`, `temp-write`, `load-recovery`, `deleteGroup`, `renameGroup`, `moveGroup`, and `ModelGroupsPersistenceError`
  - Risk lenses reviewed: raw persisted input boundary, filesystem I/O/permissions, persistence durability, Pi TUI input/focus routing, command/session integration; concurrency/external edits excluded by story beyond last-write-wins per operation
  - Finding closure: prior A22 notification-detail gap resolved in `toPersistenceMessage()` plus TUI test; prior TAP-23 temp-write gap resolved by `writeFileSync` failure test and committed-file preservation; prior backup-failure overwrite, A8 row-change rename, and TAP-20 delete proof remain resolved. New proof-contract gaps remain in TAP-16 and TAP-24.
  - Evidence quality: confirmed direct source/story/test inspection, three focused multipass child passes, focused model-groups tests (11/11), `npx tsc --noEmit`, and `npm test` (171/171); inferred schema-invalid/backup-failure boot notification behavior from the shared `index.ts` load-issue loop plus store tests; unknown live Pi dev-session smoke; provisional none, but TAP-16/TAP-24 proof rows overclaim direct test assertions.
  - Files reviewed: `openspec/initiatives/model-tag-router/initiative.md`, `openspec/changes/model-groups-data-layer-tui/{story.md,proposal.md,design.md,tasks.md,progress.md,reviews.md}`, `pi-agenticoding/{CHANGELOG.md,index.ts,state.ts,package.json}`, `pi-agenticoding/model-groups/{types.ts,store.ts,tui.ts,command.ts}`, `pi-agenticoding/tests/unit/model-groups-{crud,tui,integration}.test.ts`
  - Hypothesis triage:
    - suspicious surface: `tests/unit/model-groups-integration.test.ts` TAP-16 session_start proof; tentative issue: schema-invalid, backup-failure detail, and clean no-notification branches are claimed by the final proof row but not directly asserted by the integration test; next proof target: add/assert those `ctx.ui.notify()` fixtures or revise the proof row to match actual evidence.
    - suspicious surface: `tests/unit/model-groups-integration.test.ts` TAP-24 command-adapter proof; tentative issue: test sets `ctx.modelRegistry`/`ctx.cwd` sentinels but only asserts `ctx.ui.custom()` and rendered title, not pass-through into the component boundary; next proof target: observe factory/store arguments or otherwise assert the sentinels cross the command adapter.
    - suspicious surface: prior A22 TUI persistence error notification; tentative issue: operator notification may omit affected paths; next proof target: `toPersistenceMessage()` and TUI persistence-error test — resolved.
    - suspicious surface: prior TAP-23 temp-write proof; tentative issue: no direct `writeFileSync` temp-write failure test; next proof target: CRUD persistence-failure test — resolved.
  - Key findings:
    - TAP-16 still overclaims direct `session_start` notification coverage for named load-issue branches. Sources: `openspec/changes/model-groups-data-layer-tui/story.md:146`, `pi-agenticoding/tests/unit/model-groups-integration.test.ts:79`, `pi-agenticoding/tests/unit/model-groups-integration.test.ts:96`, `pi-agenticoding/index.ts:252`

      <details open>
      <summary><b>Medium</b> severity · <b>High</b> likelihood</summary>

      **Why:** The final proof row says the extension integration test proves corrupt/schema-invalid/unsupported-version notifications, backup-failure detail, and the clean no-notification case through `ctx.ui.notify()`. The actual integration test fixture only creates corrupt global JSON plus unsupported project version and asserts those two messages. Schema-invalid notification, backup-failure detail, and the no-issues/no-notification branch are therefore still inferred from the generic loop instead of directly proven at the claimed `session_start` boundary.

      **Assumptions / Preconditions:** TAP-16 remains the approval proof for boot load-issue notifications and the story continues to require direct extension-integration notification evidence for the named variants.

      **Downgrade Factors:** Source inspection shows `index.ts` uses one generic load-issue notification loop, and store tests produce schema-invalid and backup-failure issue data. This reduces product-risk confidence impact, but it does not make the final proof row match the actual integration test evidence.

      **Code Trail:** Story TAP-16 names schema-invalid, backup-failure detail, and clean no-notification as expected `ctx.ui.notify()` evidence. The inspected test named `index session_start notifies corrupt/schema/unsupported load issues` writes `{bad` and version `99`, then asserts `/corrupt-json/` and `/unsupported-version/` only. The boot adapter loop would notify any issue it receives, but those missing TAP-16 branches are not exercised by the integration fixture.

      **Reproduction:** Inspect `tests/unit/model-groups-integration.test.ts` lines 79-98 or run the focused model-groups suite; no assertion constructs a schema-invalid config, forces backup failure, or checks zero notifications when both validation counts and load issues are empty.

      </details>
    - TAP-24 does not prove live `ctx.modelRegistry`/`ctx.cwd` pass-through at the command-adapter boundary it claims. Sources: `openspec/changes/model-groups-data-layer-tui/story.md:154`, `pi-agenticoding/model-groups/command.ts:10`, `pi-agenticoding/tests/unit/model-groups-integration.test.ts:30`, `pi-agenticoding/tests/unit/model-groups-integration.test.ts:50`

      <details open>
      <summary><b>Medium</b> severity · <b>High</b> likelihood</summary>

      **Why:** A4/TAP-24 is specifically about the slash-command adapter opening the custom component with the live registry and cwd from the command context. The source code does pass those values, but the test only checks command registration, one `ctx.ui.custom()` call, and that the component renders `Model Groups`; it never observes or asserts that the `/tmp/cwd-sentinel` and registry sentinel reached `createModelGroupsComponent` or its store boundary.

      **Assumptions / Preconditions:** The TAP-24 row remains final and continues to claim sentinel-based pass-through proof rather than source-inspection-only evidence.

      **Downgrade Factors:** Product implementation appears correct in `model-groups/command.ts`; this is a proof-contract gap, not a confirmed user-visible bug.

      **Code Trail:** Story TAP-24 says the test uses a model-registry sentinel and cwd sentinel and proves they are passed into `createModelGroupsComponent`. The inspected test provides those fields on `ctx`, invokes the handler, calls the custom factory, and asserts only `customCalled === 1` plus the rendered title. A hard-coded-but-renderable cwd/registry could still satisfy the current assertions.

      **Reproduction:** Inspect `tests/unit/model-groups-integration.test.ts` lines 30-51; there is no spy or store assertion comparing the component call to `ctx.cwd` or `ctx.modelRegistry` despite the proof row's expected evidence.

      </details>
  - Debt Friction: none
  - Next action: `/openspec-story-resume model-tag-router model-groups-data-layer-tui`

- 2026-06-14T15:49:33Z Review run by fresh maintainer session
  - Decision: request_changes
  - Approval gate: fail
  - Product verdict: approve
  - Technical verdict: request_changes
  - Multipass review: completed
  - Prior review concerns: resolved
  - Plan lane at review time: 🟢 PLAN APPROVED
  - Initiative contract drift: none
  - Status transition: 🟣 IN REVIEW -> 🔄 IN PROGRESS
  - Sections reviewed: Purpose, Actors, Triggering Need, Expected Prerequisites, Scope, Out of Scope, Scenarios / Behavior Examples, Acceptance, Verification, Critical Files, Implementation Notes, Locked Decisions, Discovery Notes
  - Original intent checked: initiative.md, proposal.md, design.md, progress.md, prior reviews; no linked GitHub/Jira/PR source found
  - Traceability: forward gaps; backward complete
  - Design trace: gaps; rendered evidence gaps
  - Code surfaces searched: `pi-agenticoding/model-groups/{types,store,tui,command}.ts`, `pi-agenticoding/{index.ts,state.ts,CHANGELOG.md}`, `pi-agenticoding/tests/unit/model-groups-*.test.ts`, targeted searches for `TAP-13`, `TAP-14`, `TAP-19`, `TAP-25`, `renderWizard`, `renderModelEdit`, `updateDraft`, `moveGroup`, `updateGroup`, `ModelGroupsPersistenceError`, `ctx.ui.notify`, `schema-invalid`, `backupFailed`, `ctx.modelRegistry`, and `ctx.cwd`
  - Risk lenses reviewed: raw persisted input boundary, filesystem I/O/permissions, persistence durability, Pi TUI input/focus routing, command/session integration; concurrency/external edits excluded by story beyond last-write-wins per operation
  - Finding closure: prior 15:31 TAP-16/TAP-24 findings resolved by direct integration tests for schema-invalid notification, backup-failure detail, clean no-notification, cwd sentinel render, and registry sentinel `find()` calls; prior A22 notification-detail/temp-write, backup-failure overwrite, A8 row-change rename, and TAP-20 delete proof remain resolved. New TUI proof-contract gaps remain.
  - Evidence quality: confirmed direct source/story/test inspection, three focused multipass child passes, focused model-groups tests (14/14), `npx tsc --noEmit`, and `npm test` (174/174); inferred product correctness for some TUI render/error branches from source inspection; unknown live Pi dev-session smoke; provisional none, but several TUI proof rows overclaim direct automated assertions.
  - Files reviewed: `openspec/initiatives/model-tag-router/initiative.md`, `openspec/changes/model-groups-data-layer-tui/{story.md,proposal.md,design.md,tasks.md,progress.md,reviews.md}`, `pi-agenticoding/{CHANGELOG.md,index.ts,state.ts}`, `pi-agenticoding/model-groups/{types.ts,store.ts,tui.ts,command.ts}`, `pi-agenticoding/tests/unit/model-groups-{crud,tui,integration}.test.ts`
  - Hypothesis triage:
    - suspicious surface: `tests/unit/model-groups-integration.test.ts` TAP-16/TAP-24 closure; tentative issue: latest proof-gap fixes may still not assert the named branches; next proof target: schema-invalid/backup-failure/no-notification and cwd/registry sentinel tests — resolved.
    - suspicious surface: `tests/unit/model-groups-tui.test.ts` TAP-13/TAP-14/TAP-19/TAP-25 coverage; tentative issue: proof rows claim direct assertions for wizard rendering/filtering, model-edit display/filtering, move collision, and updateGroup persistence-error branches, but the TUI suite only checks happy-path store calls plus one rename error; next proof target: add focused render/error assertions or revise proof rows.
    - suspicious surface: `model-groups/tui.ts` TUI implementation; tentative issue: missing product behavior behind the proof gaps; next proof target: render/activation source and focused tests — source appears to implement the behavior, so the remaining issue is proof-contract alignment.
  - Key findings:
    - TUI proof rows still overclaim direct automated coverage for several required user-visible and error branches. Sources: `openspec/changes/model-groups-data-layer-tui/story.md:143`, `openspec/changes/model-groups-data-layer-tui/story.md:144`, `openspec/changes/model-groups-data-layer-tui/story.md:149`, `openspec/changes/model-groups-data-layer-tui/story.md:155`, `pi-agenticoding/tests/unit/model-groups-tui.test.ts:109`, `pi-agenticoding/tests/unit/model-groups-tui.test.ts:149`, `pi-agenticoding/model-groups/tui.ts:188`, `pi-agenticoding/model-groups/tui.ts:382`

      <details open>
      <summary><b>Medium</b> severity · <b>High</b> likelihood</summary>

      **Why:** The story's final TAP/proof rows say the TUI tests prove wizard provider/model/thinking lists and no fourth step, model-edit provider/model/status display, non-reasoning inherit-only thinking filtering, Location collision notification/preserve-state, and `updateGroup` persistence-error handling for add/thinking/remove paths. The inspected TUI suite does not directly assert those branches: it covers list rendering/delete, add-group naming, name row-change, happy-path move/wizard/thinking/remove store calls, and one rename persistence-error notification. Approval requires the final proof matrix to match actual automated evidence for the named variants.

      **Assumptions / Preconditions:** The TAP-13/TAP-14/TAP-19/TAP-25 rows remain the approval proof for A10-A14/A18/A22 TUI behavior and continue to claim direct unit-test assertions for those variants.

      **Downgrade Factors:** Source inspection suggests the product implementation exists: `renderModelEdit()` renders provider/model/status and filtered thinking rows, `renderWizard()` renders Step 1/3 through Step 3/3, and `updateDraft()` catches `updateGroup` errors without running the success transition. This makes the finding a proof-contract/test gap rather than a confirmed product-code defect.

      **Code Trail:** TAP-13/TAP-14/TAP-19/TAP-25 specify the missing proof obligations. The only broad TUI mutation test at `model-groups-tui.test.ts:109` drives a happy path and asserts store-call strings; it does not inspect wizard rendered rows/step count, model-edit display, non-reasoning option filtering, move-collision behavior, or add/thinking/remove failure preservation. The only TUI persistence-error test at `model-groups-tui.test.ts:149` throws from `renameGroup`, not `moveGroup` or `updateGroup` paths named by TAP-19/TAP-25.

      **Reproduction:** Inspect `tests/unit/model-groups-tui.test.ts`: the happy-path test starts at line 109 and the sole persistence-error test starts at line 149. There are no assertions for `Add model — Step 1/3`, `Provider:`, `Model ID:`, unavailable status, non-reasoning inherit-only options, move collision notification, or updateGroup failure for wizard/thinking/remove despite those being listed in `story.md` TAP rows.

      </details>
  - Debt Friction: none
  - Next action: `/openspec-story-resume model-tag-router model-groups-data-layer-tui`

- 2026-06-14T16:59:50Z Review run by fresh maintainer session
  - Decision: request_changes
  - Approval gate: fail
  - Product verdict: approve
  - Technical verdict: request_changes
  - Multipass review: completed
  - Prior review concerns: resolved
  - Plan lane at review time: 🟢 PLAN APPROVED
  - Initiative contract drift: none
  - Status transition: 🟣 IN REVIEW -> 🔄 IN PROGRESS
  - Sections reviewed: Purpose, Actors, Triggering Need, Expected Prerequisites, Scope, Out of Scope, Scenarios / Behavior Examples, Acceptance, Verification, Critical Files, Implementation Notes, Locked Decisions, Discovery Notes
  - Original intent checked: initiative.md, proposal.md, design.md, progress.md, reviews.md, notebook orientation page (file/TAP anchors only); no linked GitHub/Jira/PR source found
  - Traceability: forward gaps; backward complete
  - Design trace: gaps; rendered evidence complete for TUI surfaces reviewed
  - Code surfaces searched: `pi-agenticoding/model-groups/{types,store,tui,command}.ts`, `pi-agenticoding/{index.ts,state.ts,CHANGELOG.md}`, `pi-agenticoding/tests/unit/model-groups-*.test.ts`, targeted searches/reads for `validateModelGroups`, `degraded`, `moveGroup`, `schema-invalid`, `thinkingLevel`, `backupFailed`, `load-recovery`, `temp-write`, `ctx.ui.notify`, `ctx.modelRegistry`, `ctx.cwd`, TAP-13/TAP-14/TAP-16/TAP-19/TAP-21/TAP-24/TAP-25
  - Risk lenses reviewed: raw persisted input boundary, filesystem I/O/permissions, persistence durability, Pi TUI input/focus routing, command/session integration; concurrency/external edits excluded by story beyond last-write-wins per operation
  - Finding closure: prior 15:49 TUI proof gaps resolved by direct wizard/model-edit/move-collision/updateGroup-failure tests; prior TAP-16/TAP-24 session/command gaps remain resolved; prior A22 backup-failure overwrite, path-rich notifications, temp-write proof, and A8/TAP-20 gaps remain resolved. New data-layer proof-contract gaps remain.
  - Evidence quality: confirmed direct source/story/test inspection, three focused multipass child passes plus notebook orientation child, focused model-groups tests (18/18), `npx tsc --noEmit`, and full `npm test` (178/178); inferred product correctness for the missing data-layer branches from source inspection; unknown live Pi dev-session smoke; provisional none, but TAP-01/TAP-04/TAP-09/TAP-21 proof rows overclaim direct automated assertions
  - Files reviewed: `openspec/initiatives/model-tag-router/initiative.md`, `openspec/changes/model-groups-data-layer-tui/{story.md,proposal.md,design.md,tasks.md,progress.md,reviews.md}`, `pi-agenticoding/{CHANGELOG.md,index.ts,state.ts}`, `pi-agenticoding/model-groups/{types.ts,store.ts,tui.ts,command.ts}`, `pi-agenticoding/tests/unit/model-groups-{crud,tui,integration}.test.ts`
  - Hypothesis triage:
    - suspicious surface: `tests/unit/model-groups-tui.test.ts` TAP-13/TAP-14/TAP-19/TAP-25 closure; tentative issue: latest requested TUI proof branches may still be unproven; next proof target: wizard/model-edit/move-collision/updateGroup-failure test bodies — resolved.
    - suspicious surface: `tests/unit/model-groups-integration.test.ts` TAP-16/TAP-24 closure; tentative issue: session_start load-issue variants or command cwd/registry sentinels may still be unproven; next proof target: integration tests and command/index source — resolved.
    - suspicious surface: `tests/unit/model-groups-crud.test.ts` TAP-01/TAP-04/TAP-09/TAP-21 coverage; tentative issue: final data-layer proof rows claim direct assertions for degraded validation, move collision, absent thinking serialization, and schema-invalid backup/reset details that are not in the inspected CRUD tests; next proof target: CRUD test body and store source.
  - Key findings:
    - Data-layer proof rows still overclaim direct automated coverage for named validation, move-collision, schema-invalid recovery, and inherit-serialization branches. Sources: `openspec/changes/model-groups-data-layer-tui/story.md:131`, `openspec/changes/model-groups-data-layer-tui/story.md:134`, `openspec/changes/model-groups-data-layer-tui/story.md:139`, `openspec/changes/model-groups-data-layer-tui/story.md:151`, `pi-agenticoding/tests/unit/model-groups-crud.test.ts:45`

      <details open>
      <summary><b>Medium</b> severity · <b>High</b> likelihood</summary>

      **Why:** Approval requires the final TAP/proof matrix to match actual proof for every named variant. The current CRUD suite passes, and source inspection suggests the implementation exists, but the inspected tests do not directly assert several branches the story says are final proof: A1 degraded validation state, A18/TAP-04 store-level `moveGroup` collision rejection, TAP-09 absent `thinkingLevel` round-trip for inherit, and A21/TAP-21 schema-invalid backup/empty-config/scope-path-message details.

      **Assumptions / Preconditions:** TAP-01/TAP-04/TAP-09/TAP-21 remain the approval proof rows for those named data-layer branches, and the story continues to require direct automated proof rather than source-inspection-only evidence.

      **Downgrade Factors:** `validateModelGroups()`, `moveGroup()`, `saveModelGroups()`, and schema recovery source paths appear to implement the intended behavior, so this is a proof-contract/test gap rather than a confirmed product-code defect. Passing focused/full tests reduce regression risk for the branches they actually assert.

      **Code Trail:** The story's TAP rows require `ModelGroupValidation` with unavailable refs, shadowed and degraded, `moveGroup()` success plus collision, inherit/absent thinking serialization, and schema-invalid `.bak`/empty-config/load-issue details. The CRUD test body creates and validates unavailable/shadowed groups, rename collision, delete override, move success, schema-invalid `kind`, unsupported version, backup-failure/load-recovery, temp-write/rename/delete/move failures, but it does not assert degraded is true for a mixed valid+invalid group, does not call `moveGroup()` against a target-scope collision, does not read back a model entry with absent `thinkingLevel`, and does not assert schema-invalid `.bak`, empty affected config, issue scope/path/message.

      **Reproduction:** Inspect `tests/unit/model-groups-crud.test.ts:45-68` and `:71-81`: the validation assertions stop at `shadowedByProject` and `unavailableRefs`, the move assertions are success-only after deleting the conflicting global group, the explicit persistence assertion checks `thinkingLevel === "high"`, and the schema-invalid branch checks only `kind === "schema-invalid"`.

      </details>
  - Debt Friction: none
  - Next action: `/openspec-story-resume model-tag-router model-groups-data-layer-tui`

- 2026-06-14T17:17:56Z Review run by fresh maintainer session
  - Decision: approve
  - Approval gate: pass
  - Product verdict: approve
  - Technical verdict: approve
  - Multipass review: completed
  - Prior review concerns: resolved
  - Plan lane at review time: 🟢 PLAN APPROVED
  - Initiative contract drift: none
  - Status transition: 🟣 IN REVIEW -> ✅ DONE
  - Sections reviewed: Purpose, Actors, Triggering Need, Expected Prerequisites, Scope, Out of Scope, Scenarios / Behavior Examples, Acceptance, Verification, Critical Files, Implementation Notes, Locked Decisions, Discovery Notes
  - Original intent checked: initiative.md, proposal.md, design.md, progress.md, reviews.md; no linked GitHub/Jira/PR source found
  - Traceability: forward complete; backward complete
  - Design trace: complete; rendered evidence complete
  - Code surfaces searched: `pi-agenticoding/model-groups/{types,store,tui,command}.ts`, `pi-agenticoding/{index.ts,state.ts,CHANGELOG.md}`, `pi-agenticoding/tests/unit/model-groups-*.test.ts`, targeted reads/searches for TAP-01/TAP-04/TAP-09/TAP-13/TAP-14/TAP-16/TAP-19/TAP-21/TAP-24/TAP-25, `validateModelGroups`, `degraded`, `moveGroup`, `schema-invalid`, `thinkingLevel`, `backupFailed`, `load-recovery`, `temp-write`, `ctx.ui.notify`, `ctx.modelRegistry`, and `ctx.cwd`
  - Risk lenses reviewed: raw persisted input boundary, filesystem I/O/permissions, persistence durability, Pi TUI input/focus routing, command/session integration; concurrency/external edits excluded by story beyond last-write-wins per operation; live Pi smoke not run because story marks it useful exploratory evidence, not the approval gate
  - Finding closure: prior 16:59 data-layer proof-contract finding resolved by direct CRUD assertions for degraded validation, move target collision/preserve-state, absent `thinkingLevel` inherit round-trip, and schema-invalid `.bak`/empty-config/scope/path/message; prior TUI, session/command, and A22 findings remain resolved by direct source/test evidence and green focused/full tests
  - Evidence quality: confirmed direct source/story/test inspection, three focused multipass child passes, parent focused model-groups tests (18/18), `npx tsc --noEmit`, and full `npm test` (178/178); inferred none material; unknown live Pi dev-session smoke only; provisional none
  - Files reviewed: `openspec/initiatives/model-tag-router/initiative.md`, `openspec/changes/model-groups-data-layer-tui/{story.md,proposal.md,design.md,tasks.md,progress.md,reviews.md}`, `pi-agenticoding/{CHANGELOG.md,index.ts,state.ts}`, `pi-agenticoding/model-groups/{types.ts,store.ts,tui.ts,command.ts}`, `pi-agenticoding/tests/unit/model-groups-{crud,tui,integration}.test.ts`
  - Hypothesis triage:
    - suspicious surface: `tests/unit/model-groups-crud.test.ts` TAP-01/TAP-04/TAP-09/TAP-21 closure; tentative issue: latest proof rows might still overclaim direct data-layer assertions; next proof target: CRUD test body and focused test run — resolved.
    - suspicious surface: `tests/unit/model-groups-tui.test.ts` TAP-13/TAP-14/TAP-19/TAP-25 regression; tentative issue: prior TUI proof branches might regress after resume; next proof target: TUI source/tests and focused pass — resolved.
    - suspicious surface: `tests/unit/model-groups-integration.test.ts` TAP-16/TAP-24 regression; tentative issue: session_start load-issue variants or command cwd/registry sentinels might regress; next proof target: integration tests and command/index source — resolved.
  - Key findings:
    - None.
  - Debt Friction: none
  - Next action: Story complete locally; no `/openspec-story-resume` action required.

- 2026-06-15T07:49:57Z Review run by fresh maintainer session
  - Decision: approve
  - Approval gate: pass
  - Product verdict: approve
  - Technical verdict: approve
  - Multipass review: completed
  - Prior review concerns: resolved
  - Plan lane at review time: 🟢 PLAN APPROVED
  - Initiative contract drift: none
  - Status transition: 🟣 IN REVIEW -> ✅ DONE
  - Sections reviewed: Purpose, Scope, Scenarios / Behavior Examples, Acceptance, Verification, Design Sources, Design Element Trace, Risk Lens Inventory, Locked Decisions, Discovery Notes, Feedback Absorption Log, Plan Review Log, tasks, progress, prior reviews
  - Original intent checked: initiative/proposal/design context via story anchors and prior approval/reopen logs; no linked GitHub/Jira/PR source found
  - Traceability: forward complete for FB-001/FB-002/FB-003; backward complete to A23/A10/A24 and TAP-26/TAP-13/TAP-27
  - Design trace: complete for amended wizard keyboard behavior, authorized-only picker choices, and selected-option accent-token styling
  - Code surfaces searched: `pi-agenticoding/model-groups/tui.ts`, `pi-agenticoding/tests/unit/model-groups-tui.test.ts`, `pi-agenticoding/tests/unit/model-groups-{crud,integration}.test.ts` through focused suite, and story/tasks/progress/reviews coordination docs
  - Risk lenses reviewed: ModelRegistry authorization/API boundary, Pi TUI keyboard/focus semantics, theme token/design-token drift, plus regression check through focused model-groups and full unit suites
  - Finding closure: reopened feedback implementation resolved all approved amendments. FB-001/A23/TAP-26 is implemented by shared Esc/← `goBack()` dispatch and parity tests. FB-002/A10/TAP-13/TAP-25 is implemented by provider plus `hasConfiguredAuth(model)` filtering and same-provider unauthorized model exclusion tests. FB-003/A24/TAP-27 is implemented by selected marker/primary-label `theme.fg("accent", ...)` styling and sentinel-accent tests across list/editor/wizard/model-edit/delete-confirm surfaces. Prior full-story approval concerns remain resolved.
  - Evidence quality: confirmed direct source/test/story inspection, one focused child review, parent focused TUI test run (11/11), parent focused model-groups test run (20/20), `npx tsc --noEmit`, and full `npm test` (180/180); inferred none material; live Pi smoke not run because the story marks it exploratory rather than an approval gate
  - Files reviewed: `openspec/changes/model-groups-data-layer-tui/{story.md,tasks.md,progress.md,reviews.md}`, `pi-agenticoding/model-groups/tui.ts`, `pi-agenticoding/tests/unit/model-groups-tui.test.ts`
  - Hypothesis triage:
    - suspicious surface: add-model wizard back behavior; tentative issue: Esc might leave wizard while ← steps; proof target: shared input dispatch and TAP-26 test — resolved.
    - suspicious surface: add-model model picker; tentative issue: unauthorized same-provider models might still appear; proof target: `modelsForProvider()` and TAP-13 test — resolved.
    - suspicious surface: selected-option color; tentative issue: plugin-specific color/hardcoded hex might be used instead of Pi token; proof target: `selectableLine()` and TAP-27 sentinel theme test — resolved.
  - Key findings:
    - None.
  - Debt Friction: none
  - Next action: Story complete locally; no `/openspec-story-resume` action required.
