# Story: Model Groups spawn router

Plan: 🟢 PLAN APPROVED
Status: ✅ DONE

## Purpose

Operators can route spawned child agents through named Model Groups. The `spawn` tool accepts an optional `group` name, resolves it to one concrete authenticated model entry, applies the correct thinking level, and creates the child session on that model while preserving existing spawn isolation semantics. If no group is requested, spawn behaves exactly as it does today and inherits the parent model/thinking.

The operator-facing UX is natural language first: “spawn a review agent with the review group.” Editor autocomplete for `#group-name` is only sugar to help mention a group in the prompt; the LLM still decides whether to call `spawn` with `group`.

## Actors

- **Primary:** Pi operator — requests focused child agents and may name a Model Group naturally or with `#group-name` editor autocomplete.
- **System:** LLM parent agent — sees a names-only effective group list and maps confident operator intent to `spawn({ prompt, group })`.
- **System:** `spawn` tool — resolves optional `group`, creates isolated child session, returns child result and route metadata.
- **System:** Model Groups store/state — provides effective project-over-global group definitions and names.
- **System:** `ModelRegistry`/auth storage — validates entries, supplies concrete model objects, and preserves runtime/session-only auth for child execution.
- **System:** Pi UI — renders route identity and provides optional `#group` autocomplete.

## Triggering Need

The completed Model Groups CRUD story established durable named groups, but they are not yet consumed by spawn. Operators need a simple way to run review/research/etc. child agents on the right model pool without manually switching the parent model or exposing provider/model implementation details to the LLM prompt.

## Expected Prerequisites

- OpenSpec dependency: `model-groups-data-layer-tui` is complete and provides persisted group definitions, project-over-global merge, validation, and `/model-groups` management.
- Runtime assumptions: `pi-agenticoding` plugin is installed, current spawn tool works, `ctx.modelRegistry` is available in command/session contexts, and `ctx.ui.addAutocompleteProvider` is available when UI exists.

## Scope

1. **Spawn API contract** — replace advertised `thinking` param with optional `group?: string`; stale `thinking` args are silently ignored.
2. **Router** — add `model-groups/router.ts` for effective group lookup, exact group matching, usable-entry filtering, random per-call selection, unknown fallback, unusable-group errors, and thinking inheritance/clamping.
3. **Prompt guidance** — inject names-only effective group names and clear LLM instructions for natural-language/#group mapping in `before_agent_start`.
4. **Refresh semantics** — ensure prompt/autocomplete visibility is fresh on session start, after group changes, and after handoffs/compactions.
5. **Autocomplete** — add Pi-native `#group-name` editor autocomplete backed by effective group names, with operator-facing model/thinking descriptions; no parser/control-plane behavior.
6. **Child session execution** — route `createAgentSession()` to the selected model/thinking and prefer parent `ctx.modelRegistry` + `authStorage`; keep child session/tools/messages isolated.
7. **Result UI** — render default, routed, and unknown-fallback identity lines.
8. **Tests** — cover router branches, spawn contract, prompt injection, autocomplete, child registry/auth use, result rendering, and stale `thinking` ignore behavior.

## Out of Scope

- Interactive picker/chooser at spawn time.
- Automatic model routing without operator group intent.
- Treating groups as Pi model picker entries or meta-model proxies.
- Child profiles, frontmatter, prompts, tools, budgets, or context policies.
- Weighted policies, ordered priority semantics, health scoring, rate-limit fallback, or retry-time fallback to another group entry.
- Explicit provider/model override params on `spawn`.
- Fuzzy matching inside the router; only the LLM may map natural language to exact group names.

## Scenarios / Behavior Examples

### Normative

- **S1:** Given the spawn tool is advertised to the LLM, when the schema/prompt hints are built, then params are `prompt` and optional `group`; no `thinking` override is advertised. **Covers: A1**
- **S2:** Given a stale cached tool call includes `thinking`, when spawn executes, then `thinking` is ignored and no validation/error/result hint treats it as active input. **Covers: A2**
- **S3:** Given no `group` is supplied, when spawn executes, then the child uses the parent model and parent thinking. **Covers: A3**
- **S4:** Given project and global groups have the same name, when effective names are listed or resolved, then the project group overrides the global group. **Covers: A4**
- **S5:** Given effective groups exist, when `before_agent_start` runs, then the system prompt includes only group names plus guidance to call `spawn` with exact `group` names only when the operator intent is known/confident. **Covers: A5**
- **S6:** Given no effective groups exist, when `before_agent_start` runs, then prompt guidance does not invent groups and tells the LLM to omit `group`/inherit. **Covers: A5**
- **S7:** Given the operator types `#rev`, when autocomplete runs, then matching effective groups such as `#review` are offered with compact model/thinking details. Selecting one only inserts text into the prompt. **Covers: A6**
- **S8:** Given a known group with usable authenticated entries, when spawn executes with that group, then one usable entry is randomly selected for that spawn call. **Covers: A7**
- **S9:** Given two parallel spawn calls use the same group, when both route, then each call draws independently and records its own selected model; no shared sequence/lock forces the same result. **Covers: A7**
- **S10:** Given a selected group entry has explicit `thinkingLevel`, when spawn executes, then that level is used and clamped to the selected model capability. **Covers: A8**
- **S11:** Given a selected group entry omits `thinkingLevel`, when spawn executes, then parent thinking is inherited and clamped to the selected model capability. **Covers: A8**
- **S12:** Given `group` names an unknown group, when spawn executes, then spawn falls back to parent model/thinking and the result UI shows an unknown-fallback route. **Covers: A9**
- **S13:** Given `group` names a known empty group or a group with no usable authenticated entries, when spawn executes, then the tool fails clearly naming the unusable group. **Covers: A10**
- **S14:** Given parent auth was configured at runtime/session level, when routed spawn creates a child session, then the child uses the parent registry/auth storage rather than a fresh registry that loses auth. **Covers: A11**
- **S15:** Given routed spawn succeeds, when the result renders collapsed, expanded, or static, then the identity line is `group → provider/model • thinking`; default remains `model • thinking`; unknown fallback is `group? fallback → provider/model • thinking`. **Covers: A12**
- **S16:** Given `/model-groups` changes group definitions or a handoff compaction occurs, when the next agent starts, then the prompt/autocomplete group list reflects current effective names. **Covers: A13**

### Orientation Only

- The LLM may use natural language hints like “review agent” to choose a group only when the group name is present and the mapping is obvious. Ambiguous requests should omit `group` and inherit the parent model.
- `#group-name` is useful in prompts but should not be parsed directly from user text into tool args by extension code in this MVP.

## Acceptance

- **A1:** Spawn's advertised tool schema and prompt guidance include `prompt` and optional `group?: string`; `thinking` is not advertised as an accepted spawn argument.
- **A2:** If stale calls include `thinking`, execution ignores it silently; group omission or entry thinking rules determine child thinking.
- **A3:** Omitting `group` preserves current spawn behavior: parent model, parent thinking, inherited executable tools, no child spawn/handoff tools, shared notebook tools.
- **A4:** Effective group resolution uses project-over-global override semantics and exposes/resolves only effective group names.
- **A5:** `before_agent_start` injects a names-only Model Groups section with exact-name guidance, known/confident mapping guidance, and fallback-to-inherit guidance; no provider/model/auth details are injected.
- **A6:** Pi UI registers `#group` autocomplete that offers current effective group names with model/thinking descriptions and delegates/no-ops outside a `#` group prefix; selecting completion only inserts prompt text.
- **A7:** Known usable groups are routed by random per-call selection among entries that exist in `ModelRegistry` and pass `hasConfiguredAuth(model)`; parallel calls draw independently; selected model is not re-rolled for provider/session retry handling.
- **A8:** Routed thinking is `entry.thinkingLevel` if present, otherwise parent thinking; the final child thinking is clamped to the selected model's capability.
- **A9:** Unknown requested group names fall back to the parent model/thinking and preserve fallback metadata for rendering.
- **A10:** Known empty groups and known groups with no usable authenticated entries fail the spawn call with a clear error naming the group and reason.
- **A11:** Routed child sessions prefer parent `ctx.modelRegistry` and `ctx.modelRegistry.authStorage`; fresh registry/auth creation is allowed only as a fallback/test seam. Child session manager/messages/tools remain isolated.
- **A12:** Spawn result rendering distinguishes default, routed, and unknown-fallback routes using the required identity formats across live/collapsed/expanded/static render paths.
- **A13:** Effective group names used by prompt injection and autocomplete refresh on session start, after group mutations, and after handoffs/compactions before the next LLM call.
- **A14:** MVP explicitly excludes interactive picker, automatic routing without operator intent, groups as Pi model picker entries, child profiles, advanced policies, and provider/model override params.

## Verification

### Verification Commands

Run from `/workspaces/chunkhound_workspace/pi-agenticoding` after implementation:

```bash
node ./scripts/run-node-test.mjs \
  tests/unit/model-groups-router.test.ts \
  tests/unit/model-groups-autocomplete.test.ts \
  tests/unit/spawn.test.ts \
  tests/unit/spawn-render.test.ts \
  tests/unit/system-prompt.test.ts \
  tests/unit/model-groups-integration.test.ts

npm test
```

### Test Architecture Plan

| Row ID | Layer / Scope | Behavior / Acceptance Slice | Owning Suite / File(s) | Boundary Exercised | Assertions / Observability |
|---|---|---|---|---|---|
| TAP-01 | Unit — spawn contract | A1/A2 | `tests/unit/spawn.test.ts` | `registerSpawnTool()` schema/guidelines/execute params | Schema has `group` and no advertised `thinking`; stale `thinking` execute arg does not affect child `thinkingLevel`. |
| TAP-02 | Unit — router effective groups | A4 | `tests/unit/model-groups-router.test.ts` | `getEffectiveModelGroupNames()` / route lookup | Project group shadows global same-name; only effective names returned/resolved. |
| TAP-03 | Unit — inherited/default route | A3 | `tests/unit/model-groups-router.test.ts`, `tests/unit/spawn.test.ts` | Router + `executeSpawn()` | Omitted group returns parent model/thinking and existing child tool inheritance/exclusion remains intact. |
| TAP-04 | Unit — known usable routing | A7 | `tests/unit/model-groups-router.test.ts` | Router ↔ `ModelRegistry.find()`/`hasConfiguredAuth()` | Filters invalid/unauthenticated entries; selected entry is from usable set; rng seam proves per-call random draw. |
| TAP-05 | Unit — unknown fallback | A9/A12 | `tests/unit/model-groups-router.test.ts`, `tests/unit/spawn-render.test.ts` | Router + details renderer | Unknown group returns parent model/thinking with fallback metadata and renders `group? fallback → provider/model • thinking`. |
| TAP-06 | Unit — unusable group error | A10 | `tests/unit/model-groups-router.test.ts`, `tests/unit/spawn.test.ts` | Router error → tool error | Empty group and all-unusable group throw clear errors naming group/reason. |
| TAP-07 | Unit — thinking resolution | A8 | `tests/unit/model-groups-router.test.ts` | Router ↔ Pi thinking clamp | Entry thinking wins; absent entry thinking inherits parent; unsupported levels are clamped for selected model. |
| TAP-08 | Unit — child runtime services | A11 | `tests/unit/spawn.test.ts` | `executeSpawn()` → `createAgentSession` seam | Routed child receives selected model/thinking and parent registry/auth storage; fallback fresh registry is only used when context lacks registry. |
| TAP-09 | Unit — prompt injection | A5/A13 | `tests/unit/system-prompt.test.ts`, `tests/unit/model-groups-integration.test.ts` | `before_agent_start` + state refresh | Prompt contains names-only effective groups and guidance; no provider/model/auth details; after state refresh/handoff path names are current. |
| TAP-10 | Unit — autocomplete | A6/A13 | `tests/unit/model-groups-autocomplete.test.ts` | `ctx.ui.addAutocompleteProvider` provider | `#partial` suggests current effective names with model/thinking descriptions; non-`#` text returns/delegates no completions; provider reads live state after changes. |
| TAP-11 | Unit — result rendering | A12 | `tests/unit/spawn-render.test.ts` snapshots/assertions | `SpawnResultDetails` → renderer helper | Default, routed, and fallback identity lines render consistently in collapsed/expanded/static paths. |
| TAP-12 | Integration/regression | A14 + no scope creep | `tests/unit/spawn.test.ts`, source inspection checklist | Public surfaces | No interactive picker, no parser, no meta-model registration, no provider/model override params added. |

### Acceptance Proof Matrix

| Acceptance ID | Proof Method | Reviewer Action | Expected Evidence |
|---|---|---|---|
| A1 | Unit test TAP-01 | Run focused tests | Spawn schema exposes `group` not `thinking`; guidelines mention group routing. |
| A2 | Unit test TAP-01 | Run focused tests | Stale `thinking` arg ignored; child thinking comes from parent or routed entry. |
| A3 | Unit tests TAP-03 | Run focused tests | Omitted group route uses parent model/thinking; existing child isolation tests remain green. |
| A4 | Unit test TAP-02 | Run focused tests | Project-over-global names/resolution proved. |
| A5 | Unit test TAP-09 | Run focused tests | Prompt section has names only and explicit unknown/ambiguous fallback guidance. |
| A6 | Unit test TAP-10 | Run focused tests | `#` provider suggests effective group names with model/thinking descriptions and no-ops elsewhere. |
| A7 | Unit test TAP-04 | Run focused tests | Usable-entry filtering and rng selection seams asserted; selection called once per spawn route. |
| A8 | Unit test TAP-07 | Run focused tests | Explicit/inherited thinking and clamp behavior asserted. |
| A9 | Unit tests TAP-05 | Run focused tests | Unknown group returns fallback route and result metadata. |
| A10 | Unit test TAP-06 | Run focused tests | Empty/no-usable groups throw clear named errors. |
| A11 | Unit test TAP-08 | Run focused tests | `createAgentSession` receives parent registry/auth for routed child while keeping in-memory session manager and filtered tools. |
| A12 | Unit test TAP-11 | Run focused tests | Rendered identity strings match default/routed/fallback formats. |
| A13 | Unit tests TAP-09/TAP-10 | Run focused tests | State refresh affects prompt/autocomplete on next agent start and after group changes/handoff. |
| A14 | Unit/source proof TAP-12 | Run focused tests and inspect public params | No excluded MVP features are introduced. |

### Surface / Branch Proof Matrix

| Surface | Branches | Proof |
|---|---|---|
| `spawn` tool params | advertised group, no thinking; stale thinking ignored | TAP-01 |
| `model-groups/router.ts` | omitted group, unknown group, known empty, all-unusable, known usable | TAP-03/TAP-04/TAP-05/TAP-06 |
| Router thinking | explicit, inherited, clamped | TAP-07 |
| Runtime services | parent registry/auth preferred; fallback seam | TAP-08 |
| Prompt/autocomplete | names-only prompt; `#` suggestions; refresh | TAP-09/TAP-10 |
| Renderer | default, routed, unknown fallback; collapsed/expanded/static | TAP-11 |

### Design Sources

| Source Anchor | Status | Notes |
|---|---|---|
| Notebook `spawn-model-groups-router-research` | normative | Locked decisions and code facts from spawn/model-groups router research. |
| Prior story `model-groups-data-layer-tui` | normative dependency | Defines persisted group schema, validation, effective merge, and current state slice. |
| `pi-agenticoding/spawn/index.ts` current behavior | implementation anchor | Current spawn inherits parent model/thinking and currently advertises `thinking`; this story changes only the group-routing parts. |
| Pi autocomplete API/examples | implementation anchor | Confirms `ctx.ui.addAutocompleteProvider` can support `#` editor sugar. |
| Pi `createAgentSession`/`ModelRegistry`/thinking utilities | implementation anchor | Confirms parent registry/auth reuse and thinking clamp behavior. |

### Design Element Trace

| Design Element | Obligation | Scenario | Acceptance | Proof |
|---|---|---|---|---|
| Natural-language primary UX | LLM maps confident operator intent to exact `group`; no confident mapping means omit group | S5/S6 | A5 | TAP-09 |
| `#group` secondary UX | Autocomplete only inserts prompt text; no parser/control plane | S7 | A6/A14 | TAP-10/TAP-12 |
| Unknown fallback | Typos/NL misses inherit safely | S12 | A9/A12 | TAP-05 |
| Known unusable error | Empty/no-auth groups fail clearly | S13 | A10 | TAP-06 |
| Random per-call selection | Select one usable entry independently for each spawn | S8/S9 | A7 | TAP-04 |
| Thinking semantics | Entry wins, absent inherits, always clamp | S10/S11 | A8 | TAP-07 |
| Parent registry/auth | Runtime auth/custom registry survives child route | S14 | A11 | TAP-08 |
| Result UI | Required identity strings | S15 | A12 | TAP-11 |
| Refresh visibility | Session start/group changes/handoff see current names | S16 | A13 | TAP-09/TAP-10 |

### Risk Lens Inventory

| Risk Lens | Disposition | Coverage / Exclusion |
|---|---|---|
| Prompt injection / data leakage | Active | A5/TAP-09 require names-only listing; no provider/model/auth details in system prompt. |
| Runtime auth mismatch | Active | A11/TAP-08 require parent registry/auth reuse for child sessions. |
| Ambiguous operator intent | Active | Natural-language mapping is LLM best-effort; unknown/ambiguous should omit group or fallback safely. |
| Invalid/degraded persisted groups | Active | A7/A10 filter unusable entries and fail known unusable groups clearly. |
| Random nondeterminism | Active | RNG seam in TAP-04; no deterministic fairness or weights promised. |
| Thinking capability mismatch | Active | A8/TAP-07 clamp final thinking to selected model. |
| Scope creep | Active | A14/TAP-12 blocks picker, parser, meta-model proxy, advanced policies, and provider/model overrides. |

## Critical Files

**New:**

| File | Role |
|---|---|
| `model-groups/router.ts` | Resolve effective group names and optional spawn group to concrete model/thinking/route metadata. |
| `model-groups/autocomplete.ts` | Register Pi-native `#group-name` autocomplete backed by live effective group names. |
| `tests/unit/model-groups-router.test.ts` | Router tests for effective names, fallback/error branches, random selection, thinking clamp. |
| `tests/unit/model-groups-autocomplete.test.ts` | Autocomplete provider tests. |

**Modified:**

| File | Change |
|---|---|
| `spawn/index.ts` | Replace advertised `thinking` param with optional `group`, call router, ignore stale `thinking`, pass selected model/thinking and parent registry/auth into child session. |
| `spawn/shared.ts` | Extend result details with route metadata/provider/model fields. |
| `spawn/renderer.ts` | Render default/routed/unknown-fallback identity lines; remove thinking call hint. |
| `index.ts` | Refresh Model Groups state, inject names-only prompt section, register autocomplete when UI exists, keep state fresh after session start/group changes/handoff. |
| `system-prompt.ts` | Add static guidance or helper text for Model Groups spawn routing as needed. |
| `model-groups/command.ts` / `model-groups/tui.ts` | Ensure group mutations refresh shared `state.modelGroups` for prompt/autocomplete visibility. |
| `tests/unit/spawn.test.ts` | Spawn schema/execution/runtime service tests. |
| `tests/unit/spawn-render.test.ts` | Result rendering tests/snapshots. |
| `tests/unit/system-prompt.test.ts` / `model-groups-integration.test.ts` | Names-only prompt injection and refresh tests. |

## Implementation Notes

**Smallest red-first seam:** `model-groups/router.ts`. Start with a pure router test for omitted group, unknown fallback, known empty error, and known usable group with an injected RNG. Then wire spawn to call the router.

**Suggested phases:**

1. **Router:** implement effective names, exact group lookup, usable-entry filtering, random selection, thinking clamp, and route detail shape.
2. **Spawn contract/execution:** update `SPAWN_PARAMETERS`, prompt guidelines, `executeSpawn()` params, stale `thinking` ignore behavior, parent registry/auth reuse, and createAgentSession arguments.
3. **Prompt/autocomplete:** add names-only prompt section and `#group` provider; add shared refresh helper so state is current.
4. **Rendering:** extend result detail shape and centralize identity-line formatting for collapsed/expanded/static paths; update snapshots.
5. **Refresh hooks:** update `/model-groups` mutation paths or command callbacks to refresh `state.modelGroups`; ensure `before_agent_start` can reload defensively.
6. **Regression:** run focused tests and full `npm test`; inspect that excluded features were not added.

**Known constraints:**

- `ModelRegistry.authStorage` exists on Pi registry objects and should be reused to preserve runtime auth.
- `createAgentSession()` accepts explicit `model`, `thinkingLevel`, `modelRegistry`, and `authStorage`.
- Current spawn uses `SessionManager.inMemory()` and filters inherited tools; retain this isolation.
- Existing Model Groups validation is boot-time; route-time filtering must still check model existence/auth because group state may be stale.
- Autocomplete is UI-only; headless sessions still work through natural-language prompt guidance and `group` param.

**Red-first infeasibility:** None. Router, prompt text, autocomplete, spawn execution, and renderer are all unit-testable through existing seams.

## Locked Decisions

| Decision | Choice | Rejected alternative |
|---|---|---|
| Spawn param | `group?: string`; remove advertised `thinking`; ignore stale `thinking` | Keep per-spawn thinking override or add provider/model params |
| Group omission | Inherit parent model/thinking | Auto-pick a group or classify intent without operator request |
| Primary UX | Natural-language operator prompt mapped by LLM to exact group | Mandatory syntax or interactive picker |
| Secondary UX | `#group-name` autocomplete as editor sugar | Parser/control plane that extracts `#group` directly |
| Prompt exposure | Names-only effective group list | Provider/model/auth details in system prompt |
| Effective groups | Project overrides global; expose only effective names | Showing both global and project shadowed names |
| Selection | Random per spawn call among usable authenticated entries | Priority order, weights, health policies, or retry fallback |
| Retry | Do not re-roll after a model is selected for a spawn call | Pick a new group entry on provider retry |
| Thinking | Entry thinking wins; absent inherits parent; always clamp | Tool-level thinking override or unclamped values |
| Unknown group | Safe fallback to parent model/thinking | Fail typo/NL variation or fuzzy router matching |
| Empty/unusable known group | Clear tool error naming group/reason | Silent fallback that hides a broken group |
| Runtime services | Prefer parent registry/auth; fallback fresh only for seam | Always create fresh child registry/auth |
| Result UI | Default `model • thinking`; routed `group → provider/model • thinking`; unknown fallback `group? fallback → provider/model • thinking` | Hide routing or over-expose group internals |
| MVP exclusions | No picker, no auto-routing, no meta-model proxy, no profiles/policies/overrides | Expanding this story into a general model routing framework |

## Discovery Notes

- Current `spawn/index.ts` advertises `thinking` and uses `params.thinking ?? pi.getThinkingLevel()`; this story removes that public affordance and makes stale values inert.
- Current spawn already isolates child sessions with `SessionManager.inMemory()`, shared notebook tools, and inherited executable tool names excluding `spawn`/`handoff`; keep those semantics.
- Current spawn creates fresh `AuthStorage`/`ModelRegistry`; routed spawn must prefer parent runtime registry/auth to avoid losing session-only auth or custom model settings.
- Model Groups entries are `{ provider, modelId, thinkingLevel? }`; absent thinking means inherit.
- Model Groups store already implements project-over-global merge and validation against `ModelRegistry.find()` + `hasConfiguredAuth()`.
- Pi autocomplete providers can match `#` prefixes through `ctx.ui.addAutocompleteProvider`; this is sufficient for editor sugar without command parsing.
- Pi thinking utilities include capability-aware supported-level/clamp behavior; route-time clamping should use those rather than inventing a separate mapping.

## Plan Review Log

- 2026-06-15T14:59:44Z Plan review run by fresh maintainer session
  - Verdict: approve
  - Plan lane transition: 🟡 PLAN DRAFT -> 🟣 PLAN IN REVIEW -> 🟢 PLAN APPROVED
  - Status transition: unchanged: ⏳ NOT STARTED -> ⏳ NOT STARTED
  - Sections reviewed: Purpose, Actors, Triggering Need, Expected Prerequisites, Scope, Out of Scope, Scenarios / Behavior Examples, Acceptance, Verification, Critical Files, Implementation Notes, Locked Decisions, Discovery Notes
  - Original intent checked: initiative/proposal/design (`openspec/initiatives/model-tag-router/initiative.md`, `openspec/changes/model-groups-spawn-router/{proposal.md,design.md}`), normative notebook `spawn-model-groups-router-research`, prior dependency story `model-groups-data-layer-tui`; no linked GitHub/Jira/PR source found
  - Traceability: forward complete; backward complete
  - Design trace: complete
  - Code surfaces searched: none; plan review scoped to OpenSpec artifacts/notebook design and prior-story contract, with implementation anchors deferred to the implementation review lane
  - Risk lenses reviewed: prompt/data leakage, runtime auth mismatch, ambiguous intent/fallback, invalid/degraded groups, random nondeterminism, thinking capability clamp, scope creep
  - Evidence quality: confirmed story required sections and required verification subsections, locked design decision coverage, TAP/proof/task/critical-file traceability, and MVP non-goal guardrails; inferred none material; implementation correctness not assessed in plan-review mode
  - Finding closure: first plan review for this story; no prior plan findings
  - Key findings:
    - No blocking findings. The plan captures the locked spawn/model-groups router design: optional `group`, stale `thinking` ignored, names-only prompt guidance, `#group` autocomplete as editor sugar, project-over-global effective groups, random per-call routing, thinking inheritance/clamping, unknown fallback, known-unusable error, parent registry/auth reuse, result UI variants, and MVP exclusions.
    - Schema-required story sections and required verification subsections are present. Acceptance A1-A14 maps to scenarios S1-S16 and proof rows TAP-01 through TAP-12, with critical files and task phases named for each implementation seam.
    - No initiative/prior-story drift found: this remains the atomic follow-up to completed Model Groups CRUD, keeps CRUD persistence/validation as a dependency, and excludes picker/meta-model/profiles/policies/provider-model overrides.
  - Hypothesis triage: none
  - Debt Friction: none
  - Next action: Run `/openspec-story-claim model-tag-router model-groups-spawn-router` from a fresh session.
