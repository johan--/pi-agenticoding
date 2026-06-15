# Design: Model Groups spawn router

## Architecture

This story extends the existing `pi-agenticoding` extension surfaces instead of adding a new extension:

```text
pi-agenticoding/
  model-groups/
    router.ts          — effective group lookup + spawn route resolution
    autocomplete.ts    — #group-name editor autocomplete provider
    store.ts/types.ts  — existing CRUD, validation, persisted definitions
  spawn/
    index.ts           — spawn tool schema/execution uses optional group
    shared.ts          — result detail shape includes route metadata
    renderer.ts        — routed/fallback result identity lines
  index.ts             — state refresh, prompt injection, autocomplete registration
  system-prompt.ts     — static primer plus dynamic Model Groups guidance
  state.ts             — existing modelGroups snapshot used by prompt/autocomplete
```

Data flow:

1. `session_start` and `/model-groups` mutations refresh `state.modelGroups` from the persisted model-groups store.
2. `before_agent_start` reads fresh effective group names and injects a names-only Model Groups section into the system prompt.
3. The operator either asks naturally for a group or uses `#group-name` autocomplete to mention one.
4. The LLM calls `spawn({ prompt, group? })` when it confidently maps the request to a known group. If not, it omits `group`.
5. `spawn` calls `model-groups/router.ts` to resolve the optional group to concrete `{ model, thinkingLevel, routeStatus }`.
6. `executeSpawn()` creates an isolated in-memory child session using the resolved model/thinking, inherited tools/notebook tools, and the parent registry/auth storage where available.
7. `spawn/renderer.ts` displays default/routed/fallback identity lines.

## Spawn Tool Contract

Advertised tool params:

```ts
const SPAWN_PARAMETERS = Type.Object({
  prompt: Type.String({ description: "Self-contained task description..." }),
  group: Type.Optional(Type.String({
    description: "Optional Model Group name for child model routing. Omit to inherit the parent model/thinking.",
  })),
});
```

Execution params may still be typed with an internal `thinking?: unknown` tolerance seam so older cached calls do not fail validation paths, but implementation must ignore it. This story removes any prompt guideline, rendered call hint, or public schema text advertising `thinking` as spawn input.

## Router API

`model-groups/router.ts` owns all group-to-model behavior. Suggested shape:

```ts
type SpawnRouteStatus = "inherited" | "routed" | "unknown-fallback";

type SpawnModelRoute = {
  status: SpawnRouteStatus;
  requestedGroup?: string;
  groupName?: string;
  model: Model<any>;
  provider: string;
  modelId: string;
  thinking: ThinkingValue;
};

type SpawnRouteError = {
  kind: "unusable-group";
  group: string;
  reason: "empty" | "no-usable-models";
  message: string;
};

function getEffectiveModelGroupNames(groups: ResolvedModelGroup[]): string[];
function resolveSpawnModelRoute(options: {
  requestedGroup?: string;
  groups: ResolvedModelGroup[];
  parentModel: Model<any>;
  parentThinking: ThinkingValue;
  modelRegistry: ModelRegistry;
  rng?: () => number;
}): SpawnModelRoute;
```

Implementation may adjust exact names, but the ownership and semantics must remain in `model-groups/router.ts`.

## Effective Group Resolution

- Effective groups are the merged project-over-global result already modeled by the CRUD story.
- Expose only effective group names to the LLM prompt. Autocomplete may show operator-facing model/thinking details in suggestion descriptions, but it still inserts/selects only the effective `#group-name` token.
- A global group shadowed by a project group is not exposed or selectable by name; the project group is the effective group.
- Group names are matched exactly after trimming. The LLM may map natural language to a name, but the router does not perform fuzzy matching.

## Route Resolution Rules

1. **No group requested:** return parent model + parent thinking with `status: "inherited"`.
2. **Unknown group requested:** return parent model + parent thinking with `status: "unknown-fallback"` and preserve `requestedGroup` for UI.
3. **Known empty group:** throw a clear unusable-group error naming the group and saying it has no model entries.
4. **Known group with entries:** filter to entries whose `modelRegistry.find(provider, modelId)` succeeds and whose model passes `modelRegistry.hasConfiguredAuth(model)`.
5. **Known group with zero usable entries:** throw a clear unusable-group error naming the group and saying no configured/authenticated models are usable.
6. **Known group with usable entries:** choose one usable entry using random selection per spawn call. Parallel calls draw independently.
7. **Retry behavior:** after a model is selected for a spawn call, keep that selection. Provider/session retry handling must not ask the router to choose a different entry for the same spawn call.

## Thinking Resolution

- If the selected group entry has `thinkingLevel`, that explicit value is the requested child thinking.
- If the entry omits `thinkingLevel`, inherit the parent thinking level from `pi.getThinkingLevel()`.
- Always clamp the requested thinking to the selected model capability using Pi's thinking clamp utility (`clampThinkingLevel`) or the equivalent `getSupportedThinkingLevels()` behavior.
- Unknown-group fallback uses the parent model and parent thinking; any stale `params.thinking` value is ignored.

## Child Session Registry/Auth

Current spawn creates a fresh `AuthStorage` and `ModelRegistry` for children. Routed spawn should prefer parent runtime services:

```ts
const authStorage = ctx.modelRegistry?.authStorage ?? AuthStorage.create();
const modelRegistry = ctx.modelRegistry ?? ModelRegistry.create(authStorage);
```

Pass those services into `createAgentSession({ authStorage, modelRegistry, model, thinkingLevel, sessionManager: SessionManager.inMemory(), ... })`.

Isolation remains unchanged:

- Child session manager is still in-memory and separate from the parent.
- Child messages/session state remain isolated.
- Child tool list still inherits only active registered tools executable in the child and excludes `spawn`/`handoff`.
- Notebook tools remain shared through the extension state.
- Fresh registry/auth construction is only a fallback/test seam when `ctx.modelRegistry` is unavailable.

## Prompt Injection

Dynamic prompt section in `before_agent_start`:

```text
## Model Groups for spawn
Available Model Groups: review, research
When the operator asks to spawn with one of these groups, or mentions #group-name,
call spawn with group set to the exact group name. If no known/confident group is
requested, omit group and inherit the parent model/thinking. The group list is
names-only; do not assume provider/model membership from it.
```

Rules:

- Names-only; never include provider IDs, model IDs, thinking levels, auth status, validation issues, or persisted paths.
- If no effective groups exist, either omit the section or state that no Model Groups are available.
- Refresh before composing the prompt on session start and after group changes. `before_agent_start` should see fresh `state.modelGroups` or reload it.
- Handoff compaction should not drop group visibility; the first post-handoff agent start should receive the current names.

## `#group` Autocomplete

`model-groups/autocomplete.ts` registers a Pi-native autocomplete provider with `ctx.ui.addAutocompleteProvider` when UI is available.

Behavior:

- Trigger on the current token prefix matching `#<partial-name>`.
- Offer effective group names as `#group-name` completions.
- Show compact model/thinking details in suggestion descriptions so operators can see what the group may route to; absent entry thinking is displayed as inherit, and unavailable entries may be marked unavailable.
- Provider reads names from live `state.modelGroups` so group changes are reflected without restarting the session where possible.
- If the current token is not a `#` group prefix, delegate/return no completions without interfering with other providers.
- The inserted token is only text in the prompt. The LLM interprets it through system-prompt guidance; no parser extracts `#group` directly into tool params.

## Result Rendering

Extend `SpawnResultDetails` with route metadata, e.g.:

```ts
type SpawnRouteDetails =
  | { status: "inherited" }
  | { status: "routed"; group: string; provider: string; modelId: string }
  | { status: "unknown-fallback"; requestedGroup: string; provider: string; modelId: string };
```

Render identity lines:

- Default/inherited: `model • thinking` (preserve current behavior).
- Routed: `group → provider/model • thinking`.
- Unknown fallback: `group? fallback → provider/model • thinking`.

The renderer should use the same helper for collapsed, expanded, and static result paths so snapshots stay aligned.

## Plugin Integration

- Register spawn with the new schema and prompt guidelines.
- Add a state refresh helper for Model Groups so `session_start`, `/model-groups` mutations, and `before_agent_start` share one path.
- Register the autocomplete provider in a UI-capable session path and keep it live through state reads.
- Update system-prompt tests to assert names-only group listing and fallback guidance.

## Error Handling

- Unknown group names are non-fatal: fallback to inherited parent model/thinking and render fallback metadata.
- Known unusable groups are fatal for that spawn call: return a clear tool error naming the group and whether it is empty or has no usable configured models.
- Router should not surface raw persistence paths or full config contents in LLM prompt guidance or tool results unless the error is an operator-facing unusable-group message.

## Design Source Classification

| Source | Classification | Notes |
|---|---|---|
| `spawn-model-groups-router-research` notebook | normative | Locked decisions from the design grilling session and current code facts. |
| `openspec/changes/model-groups-data-layer-tui/` | normative dependency | Existing data model, persistence paths, effective project-over-global merge, and validation behavior. |
| `pi-agenticoding/spawn/index.ts` | implementation anchor | Current spawn execution, child isolation, tool inheritance, stale `thinking` location to remove/ignore. |
| Pi `ctx.ui.addAutocompleteProvider` and autocomplete examples | implementation anchor | Confirms `#` autocomplete can be Pi-native editor sugar. |
| Pi `createAgentSession`, `ModelRegistry.authStorage`, `clampThinkingLevel` | implementation anchor | Confirms routed child sessions can reuse parent registry/auth and clamp thinking. |

## Key Non-Goals Guardrail

Do not add a second model picker, meta-model proxy, intent classifier, or hidden `#group` parser. This story routes only when the LLM explicitly calls `spawn` with `group`, guided by names-only prompt context and optional editor autocomplete.
