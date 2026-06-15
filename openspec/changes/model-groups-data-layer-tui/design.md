# Design: Model Groups CRUD

## Architecture

The Model Groups feature follows the same extension module pattern as `notebook/`, `handoff/`, and `spawn/`:

```
pi-agenticoding/
  model-groups/
    types.ts       — data model types
    store.ts       — CRUD service with file I/O
    tui.ts         — custom TUI component (state machine + rendering)
    command.ts     — /model-groups command handler
  index.ts          — registers command + boot validation hook
  state.ts          — modelGroups state slice
```

The TUI uses a single `ctx.ui.custom()` component with an internal screen state machine (mirroring the HTML mockup architecture). The command adapter (`registerModelGroupsCommand`) registers `/model-groups`, invokes `ctx.ui.custom()`, and wires live `ctx.modelRegistry` plus `ctx.cwd` into the component. The CRUD service manages two JSON files independently. Browser-only mockup mechanics are not implementation contracts: Pi custom TUI input arrives through `handleInput(data: string)`, and text-entry safety must be represented with component/focus state rather than DOM selectors.

## Data Model

```ts
type ModelGroupsConfig = {
  version: 1;
  groups: Record<string, ModelGroupDef>;
};

type ModelGroupDef = {
  models: ModelGroupModel[];
};

type ModelGroupModel = {
  provider: string;
  modelId: string;
  thinkingLevel?: ModelThinkingLevel; // absent = inherit
};

type ModelGroupScope = 'project' | 'global';

type ModelGroupValidation = {
  unavailableRefs: Array<{ provider: string; modelId: string }>;
  shadowedByProject: boolean;
  degraded: boolean;
};

type ResolvedModelGroup = ModelGroupDef & {
  name: string;
  scope: ModelGroupScope;
  sourcePath: string;
  validation: ModelGroupValidation;
};

type ModelGroupsLoadIssue = {
  scope: ModelGroupScope;
  sourcePath: string;
  kind: 'corrupt-json' | 'schema-invalid' | 'unsupported-version';
  message: string;
  backupPath?: string;
  backupFailed?: boolean;
  version?: number;
};

type ModelGroupsPersistenceError = {
  operation: 'save' | 'delete' | 'move';
  scope?: ModelGroupScope;
  sourcePath?: string;
  targetPath?: string;
  phase: 'temp-write' | 'rename' | 'source-remove';
  partialMove?: 'target-written-source-retained';
  message: string;
  cause?: unknown;
};

type ModelGroupsLoadedGroup = ModelGroupDef & {
  name: string;
  scope: ModelGroupScope;
  sourcePath: string;
};

type ModelGroupsLoadResult = {
  configs: Record<ModelGroupScope, ModelGroupsConfig>;
  merged: ModelGroupsLoadedGroup[];
  issues: ModelGroupsLoadIssue[];
};

type ModelGroupsBootValidation = {
  groups: ResolvedModelGroup[];
  loadIssues: ModelGroupsLoadIssue[];
};
```

- `ModelGroupsConfig.version` gates forward-compatibility. Current version is `1`. Unknown higher versions refuse to load.
- `ModelGroupDef.models` is an ordered array (preserving insertion order for display, not priority semantics). Empty array is valid.
- `ModelGroupModel.thinkingLevel` absent = inherit caller/runtime/default. Matches Pi's native `ScopedModel.thinkingLevel?` pattern.
- `ModelGroupValidation` is computed at boot from `ModelRegistry.find()` + `hasConfiguredAuth()`. Not persisted.
- `ModelGroupsLoadIssue` is the store/UI seam for corrupt/schema/unsupported-version loads, including backup-failure detail when recovery cannot create `.bak`. The store records typed issues; `index.ts`/TUI adapters own turning them into `ctx.ui.notify()` messages.
- `ModelGroupsPersistenceError` is the store/UI seam for failed writes, renames, deletes, and cross-scope move phases. Store functions throw it with operation/scope/path/phase details; command/TUI adapters own notification and preserving visible state until a confirmed write succeeds.

## Persistence Strategy

- **Global:** `~/.pi/agent/pi-agenticoding/model-groups.json`
- **Project:** `<cwd>/.pi/pi-agenticoding/model-groups.json`
- **Merge rule:** project groups override same-name global groups. Unrelated groups from both scopes survive.
- **Atomic per-file writes:** temp file + rename pattern for each scope file.
- **Corrupt/schema recovery:** malformed JSON or schema violation → `.bak` backup created, config reset to empty for that scope, `ModelGroupsLoadIssue` returned with `kind: 'corrupt-json'` or `kind: 'schema-invalid'`.
- **Backup failure:** if `.bak` creation fails, the original file is not overwritten or deleted; the current in-memory load uses empty config for that scope and the `ModelGroupsLoadIssue` includes `backupFailed: true` plus the attempted path/message so the caller can notify.
- **Version gating:** version > 1 → refuse to load, empty config for that scope, `ModelGroupsLoadIssue` returned. Version missing or 0 → treat as 1, repair on next write.
- **Write failure:** temp-write, rename, delete/source-removal, and access-denied failures throw `ModelGroupsPersistenceError`; callers notify and keep visible state on last confirmed data.
- **Cross-scope move partial failure:** `moveGroup` writes the target before removing the source. If target write fails, source remains unchanged and the move fails. If source removal fails after target write, the error reports `partialMove: 'target-written-source-retained'`; UI must not claim a clean move and should notify that retry/cleanup is needed.
- **Notification ownership:** store functions never import or receive `ctx.ui`; `index.ts` `session_start` and command/TUI adapters translate `ModelGroupsLoadIssue` values and `ModelGroupsPersistenceError` throws into `ctx.ui.notify()` warnings.

## CRUD Service

```ts
// In model-groups/store.ts

function loadModelGroups(cwd: string): ModelGroupsLoadResult;
function saveModelGroups(scope: ModelGroupScope, cwd: string, config: ModelGroupsConfig): void;
function listResolvedModelGroups(cwd: string, modelRegistry: ModelRegistry): ModelGroupsBootValidation;

function createGroup(scope: ModelGroupScope, cwd: string, name: string, def: ModelGroupDef): void;
  // throws if name exists in same scope

function updateGroup(scope: ModelGroupScope, cwd: string, name: string, def: ModelGroupDef): void;
  // throws if name doesn't exist

function renameGroup(scope: ModelGroupScope, cwd: string, oldName: string, newName: string): void;
  // throws if newName exists in same scope

function deleteGroup(scope: ModelGroupScope, cwd: string, name: string): { otherScopeHasOverride: boolean };
  // returns warning metadata for UI

function moveGroup(cwd: string, name: string, newScope: ModelGroupScope): void;
  // success path: write to target scope file, then remove from source scope file
  // throws if target scope already has same-name group
  // throws ModelGroupsPersistenceError on temp-write/rename/source-remove failure; source is not removed before target write succeeds

function validateModelGroups(loadResult: ModelGroupsLoadResult, modelRegistry: ModelRegistry): ResolvedModelGroup[];
  // returns each group with computed ModelGroupValidation; caller preserves loadResult.issues for notification/state
```

All CRUD functions operate on the full `ModelGroupsConfig` per scope. Model-level mutations (add/remove/update model entries within a group) are handled by the TUI editing a full group in memory and calling `updateGroup` to persist the whole group. `createGroup` persists the caller-provided name and rejects same-scope collisions; the TUI/command `+ Add group` flow owns computing `new-group`, then `new-group-N`, before calling it. Store functions surface recoverable load problems through `ModelGroupsLoadIssue` and persistence failures through `ModelGroupsPersistenceError`; UI notification remains owned by extension integration. CRUD callers refresh state only after a successful write/delete/move, or explicitly surface a `partialMove` retry/cleanup warning.

## Validation

Boot-only on `session_start`:

1. `loadModelGroups(cwd)` → per-scope configs, merged groups, and `ModelGroupsLoadIssue[]`
2. For each loaded group and each model entry: `modelRegistry.find(provider, modelId)` — existence check
3. `modelRegistry.hasConfiguredAuth(model)` — auth check (in-memory, synchronous)
4. Compute per-group `ModelGroupValidation`:
   - `unavailableRefs`: model entries that fail find() or hasConfiguredAuth()
   - `shadowedByProject`: global group with same-name project group
   - `degraded`: at least one available model + at least one unavailable
5. Aggregate unavailable/override counts for boot validation notification
6. Notify for any `ModelGroupsLoadIssue` (corrupt/schema/unsupported-version, including backup failure detail) via the caller's `ctx.ui.notify()`
7. Return `ModelGroupsBootValidation` for TUI/state consumption

## TUI Component Architecture

### Screen States

```
LIST ←──────────────────────────────────────┐
  │ Enter on group                           │ Esc
  ▼                                          │
EDITOR ──→ MODEL_EDIT ──→ (back) ───────────┘
  │           │ D remove
  │ + Add     ▼
  ▼         EDITOR
WIZARD_PROVIDER
  │ Enter
  ▼
WIZARD_MODEL
  │ Enter
  ▼
WIZARD_THINKING ── Enter → EDITOR
  
LIST ── D → DELETE_CONFIRM ── Esc/Keep → LIST
                              ── Delete → LIST
```

### Component Structure

```ts
// model-groups/tui.ts
function createModelGroupsComponent(
  tui: TUI,
  theme: Theme,
  modelRegistry: ModelRegistry,
  cwd: string,
  done: (result: void) => void
): Component {

  const state = {
    screen: 'LIST' as ScreenId,
    row: 0,
    search: '',
    activeTextInput: null as null | 'search' | 'group-name' | 'wizard-filter',
    groups: [] as ResolvedModelGroup[],
    editDraft: null as ModelGroupDef | null,
    editName: null as string | null,
    editScope: 'project' as ModelGroupScope,
    modelEditIndex: -1,
    wizard: { step: 1, provider: '', modelId: '', thinking: undefined as ModelThinkingLevel | undefined },
  };

  // Load and validate on init; command adapter notifies for load issues
  state.groups = listResolvedModelGroups(cwd, modelRegistry).groups;

  return {
    render: (width) => { /* dispatch per state.screen */ },
    handleInput: (data) => {
      const inTextInput = state.activeTextInput !== null;
      if (isDeleteChord(data) && !inTextInput && (state.screen === 'LIST' || state.screen === 'MODEL_EDIT')) {
        // trigger delete
      }
      // printable input, arrow navigation, Enter activation, Esc back
    },
  };
}
```

### Screen Rendering Approach

| Screen | Pi Primitive Used | Notes |
|--------|------------------|-------|
| LIST | `SelectList` | Groups as items with labels, meta, health indicators |
| EDITOR | Custom `Container` | Mixed row types: Location `SelectList`, name `Input`, model rows, +Add row |
| MODEL_EDIT | Custom `Container` | Model info + thinking `SelectList` + remove row |
| WIZARD_PROVIDER | `SelectList` | Live providers from `modelRegistry.getAll()` |
| WIZARD_MODEL | `SelectList` | Filtered by chosen provider and `modelRegistry.hasConfiguredAuth(model)` |
| WIZARD_THINKING | `SelectList` | Filtered by `getSupportedThinkingLevels()` |
| DELETE_CONFIRM | Custom `Container` | Summary text + Keep/Delete `SelectList` |

### Key Handling

- **Arrows:** row navigation, clamped by `maxRow()` per screen
- **Enter:** `activate()` per screen (open, select, add, confirm)
- **D:** delete trigger (LIST → confirm dialog; MODEL_EDIT → remove model), guarded by the component's active text-entry/focus state; focused Pi `Input` or custom text-entry rows receive `d` as printable input
- **Delete key:** unadvertised fallback (same behavior as D)
- **Esc / ← Left in wizard:** shared wizard back-navigation (thinking→model, model→provider, provider→editor)
- **Esc outside wizard:** back navigation (editor→list→main; model-edit/delete-confirm→list)
- **Typing:** search filter and name input when respective fields are focused through Pi component state/`Input.focused`; no DOM `[data-input]` checks
- **Model picker authorization:** the model step never offers a model unless `modelRegistry.hasConfiguredAuth(model)` is true for that model
- **Selected option styling:** selected option markers and primary labels use Pi's standard `accent` foreground (`theme.fg("accent", ...)`, matching `getSelectListTheme()`/`getSettingsListTheme()`); the current built-in dark theme resolves this light mint-green accent to `#8abeb7`

### Immediate Apply

Every mutation calls the CRUD service immediately:
- Add group → TUI computes the first available `new-group`/`new-group-N`, then calls `createGroup('project', cwd, name, { models: [] })`
- Name change → on row change, Enter, or Esc from the name field, flush pending text by calling `renameGroup` (or `updateGroup` if name unchanged) before navigation
- Location switch → Location row activation calls `moveGroup(cwd, name, newScope)` and updates visible scope only after success; on `ModelGroupsPersistenceError`, notify and keep the visible scope on last confirmed state unless `partialMove: 'target-written-source-retained'` requires an explicit retry/cleanup warning
- Thinking change → `updateGroup(scope, cwd, name, modifiedDef)` with the changed model entry; refresh editor state only after success, and on `ModelGroupsPersistenceError`, notify while keeping the last confirmed visible entry
- Model add/remove → `updateGroup(scope, cwd, name, modifiedDef)` with the full modified group; return to/refresh the editor only after success, and on persistence error notify while preserving the last confirmed visible state
- Group delete → LIST `D` opens `DELETE_CONFIRM`; confirmed Delete calls `deleteGroup(scope, cwd, name)` and then refreshes LIST. Same-name other-scope warning comes from resolved/list state and store warning metadata.

No save button, no dirty tracking, no discard flow.

## Plugin Integration

### Command Registration (index.ts and model-groups/command.ts)

```ts
// index.ts
import { registerModelGroupsCommand } from "./model-groups/command.js";

export default function (pi: ExtensionAPI): void {
  // ... existing registrations ...
  registerModelGroupsCommand(pi, state);
}

// model-groups/command.ts
export function registerModelGroupsCommand(pi: ExtensionAPI, state: AgenticodingState): void {
  pi.registerCommand("model-groups", {
    description: "Manage Model Groups",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      await ctx.ui.custom<void>((tui, theme, _keybindings, done) =>
        createModelGroupsComponent(tui, theme, ctx.modelRegistry, ctx.cwd, done),
      );
    },
  });
}
```

The command adapter is the only place that reads `ctx.modelRegistry`/`ctx.cwd` for the interactive TUI. Tests should mock `ExtensionAPI.registerCommand`, invoke the registered handler, assert `ctx.ui.custom()` is called, and assert the component factory receives the same registry and cwd sent through the command context.

### Boot Validation (index.ts)

```ts
pi.on("session_start", async (event, ctx: ExtensionContext) => {
  // ... existing session_start logic ...
  
  const loaded = loadModelGroups(ctx.cwd);
  const groups = validateModelGroups(loaded, ctx.modelRegistry);
  state.modelGroups = { groups, validation: { groups, loadIssues: loaded.issues } };
  
  for (const issue of loaded.issues) {
    const backupNote = issue.backupFailed ? "; backup failed, original file left untouched" : "";
    ctx.ui.notify(`Model Groups config ${issue.kind} in ${issue.scope} scope (${issue.sourcePath}); using empty config for that scope${backupNote}`, "warning");
  }
  
  const unavailableCount = groups.reduce((s, g) => s + g.validation.unavailableRefs.length, 0);
  const overrideCount = groups.filter(g => g.validation.shadowedByProject).length;
  
  if (unavailableCount > 0 || overrideCount > 0) {
    ctx.ui.notify(`Model Groups boot validation: ${unavailableCount} unavailable model references · ${overrideCount} project overrides`, "warning");
  }
});
```

## Design Source Classification

| Source | Classification | Normative Use | Explicit Divergences / Exclusions |
|--------|----------------|---------------|-----------------------------------|
| `agent_coordination/epics/model-tag-router/mockups/interactive-mockup.html` | Normative for visible screen sequence, row ordering, health tags, delete confirmation, immediate-apply UX, and provider→model→thinking wizard shape | Map rendered intent into Pi TUI primitives | DOM `[data-input]` selectors are browser-only and excluded; stale `Step 1/4` and `Step 2/4` labels are overridden by exactly three wizard steps; static thinking option lists are overridden by `getSupportedThinkingLevels()`. |
| Pi TUI/extension/model source | Normative API boundary | `ctx.ui.custom()`, `Component.handleInput(data: string)`, `Input.focused`, `ctx.modelRegistry`, `ctx.ui.notify()`, `session_start` | Browser event objects are not available in Pi custom components; store functions stay UI-free and emit typed load issues/errors for callers to notify. |

## Keybindings

- `D` handled inside the TUI component's `handleInput()`, not via `pi.registerShortcut()`
- Guard: only fires on LIST and MODEL_EDIT screens when the Pi component's active input/focus state says no text input is active
- `Delete` key: unadvertised fallback using same logic
- If promoted to Pi core later: add `app.modelGroups.delete` keybinding ID defaulting to `shift+d`
