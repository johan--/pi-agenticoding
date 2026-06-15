# Initiative: Model Groups CRUD for pi-agenticoding

## Goal / Context

Give pi-agenticoding a durable, Pi-native Model Groups manager — a CRUD-first TUI panel (`/model-groups`) for defining named groups of models with optional thinking levels, persisted to global and project scope. Group definitions are validated against the live `ModelRegistry` at boot.

Phase 1 of the model-groups feature is complete: **solid CRUD only**. Model resolution, spawn integration, and routing semantics are handled by follow-up stories, starting with `model-groups-spawn-router`.

**Done:** The operator can open `/model-groups` from any Pi session, create/edit/rename/delete model groups and their model entries, switch group scope between project and global, and see boot-time validation health (unavailable model refs, project overrides, degraded states).

**In PR:** The spawn tool can optionally accept a Model Group name, resolve it to a concrete authenticated model + thinking level, and keep default spawn behavior unchanged when no group is requested.

## Scope

Three planned stories:

1. **Model Groups CRUD** (done) — Data layer (schema, persistence, validation) + TUI management panel (list, editor, model edit, add-model wizard, delete confirm). Boot validation on `session_start`. No spawn/routing integration. Change: `openspec/changes/model-groups-data-layer-tui/`.
2. **Model Groups spawn router** (in PR) — Add optional `group` parameter to the spawn tool, resolve a named group to one concrete authenticated model + clamped thinking level, inject names-only group guidance for natural-language/#group use, and render default/routed/fallback spawn identity. Change: `openspec/changes/model-groups-spawn-router/`.
3. **Meta-model proxy** (future) — Register groups as logical Pi models in the model picker (follow-up epic with known pain points).

## Constraints

- Lives inside the existing `pi-agenticoding` plugin at `/workspaces/chunkhound_workspace/pi-agenticoding`, in a new `model-groups/` module.
- Persistence: self-managed JSON files — `~/.pi/agent/pi-agenticoding/model-groups.json` (global) and `<cwd>/.pi/pi-agenticoding/model-groups.json` (project). No SettingsManager dependency (not accessible from extensions).
- TUI: single `/model-groups` command via `pi.registerCommand()`, internal state machine using `ctx.ui.custom()` with Pi TUI primitives.
- Model picker: uses live `ModelRegistry` data (`getAll()`, `getAvailable()`).
- Thinking levels: stored as `ModelThinkingLevel`, absent means inherit. Picker filtered by model capability via `getSupportedThinkingLevels()`.
- Validation: boot-only snapshot on `session_start`, surfaced via `ctx.ui.notify()` and inside the Model Groups list. No Pi model-validation hooks exist; own validation layer on top of `ModelRegistry`.
- Delete: `D` key inside the custom TUI component, guarded against text input focus. `Delete` key as unadvertised fallback.
- Feature label: "Model Groups". Command: `/model-groups`.

## Non-goals

- NOT spawn/routing integration in the CRUD story; story 2 covers first spawn routing via optional `spawn.group`.
- NOT meta-model proxy / groups as logical Pi models (follow-up epic).
- NOT automatic model routing, rate-limit fallback, or intent classification.
- NOT child-agent profiles, frontmatter, prompts, tools, or context policies.
- NOT additional invocation syntax beyond story 2's natural-language guidance and optional `#group` editor autocomplete sugar.
- NOT changing how handoff or parent session selects models.

## External Resources

- Live mockup: `agent_coordination/epics/model-tag-router/mockups/interactive-mockup.html`
- Pi codebase: `/workspaces/chunkhound_workspace/pi` (read-only reference for APIs/patterns)
- Plugin codebase: `/workspaces/chunkhound_workspace/pi-agenticoding`
- Research pages: `model-tag-router-pi-extension-surface-research`, `model-tag-router-pi-model-registry-research`, `model-tag-router-pi-tui-primitives-research`, `model-tag-router-pi-spawn-primitives-research`, `model-tag-router-pi-native-data-model-design`, `spawn-model-groups-router-research`
- Mockup page: `model-tag-router-dynamic-mockup`
