# Proposal: model-groups-data-layer-tui

## Goal / Context

The pi-agenticoding plugin's spawn tool needs a model routing capability — the operator defines model groups, and spawn can select from them dynamically. Before routing can exist, the groups must be defined and managed. This story builds the CRUD foundation that routing will consume.

The operator can open `/model-groups` from any Pi session and manage named model groups with full CRUD — create, rename, edit, and delete groups; add, edit, and remove model entries within groups (each entry specifying provider, model ID, and optional thinking level); switch group scope between project and global. On session start, all group definitions are validated against the live model registry, and health issues are surfaced as a boot notification and within the Model Groups list. Groups persist to durable plugin-owned JSON files in global and project scope, with project groups overriding same-name global groups. No save/discard model — all edits apply immediately.

## Story Candidates

Single story — this change is the full CRUD scope.

## Decisions & Constraints

- Lives inside the existing `pi-agenticoding` plugin at `/workspaces/chunkhound_workspace/pi-agenticoding`, new `model-groups/` module.
- Persistence: self-managed JSON files (`~/.pi/agent/pi-agenticoding/model-groups.json` global, `<cwd>/.pi/pi-agenticoding/model-groups.json` project). `SettingsManager` is not accessible from extensions.
- TUI: single `/model-groups` command via `pi.registerCommand()`, internal state machine using `ctx.ui.custom()` with Pi TUI primitives.
- Model picker: live `ModelRegistry` data. Thinking levels filtered by `getSupportedThinkingLevels()`. Absent `thinkingLevel` = inherit.
- Validation: boot-only on `session_start`. Pi has no model validation hooks — own layer on top of `ModelRegistry`.
- Delete: `D` in-component, guarded by Pi component active input/focus state (not DOM selectors). `Delete` key as unadvertised fallback.
- Feature label: "Model Groups". No Validate row/action. No save/dirty/discard.
- Out of scope: spawn integration, routing semantics, invocation syntax, child-agent profiles.

## External Resources

- Mockup: `agent_coordination/epics/model-tag-router/mockups/interactive-mockup.html`
- Pi codebase: `/workspaces/chunkhound_workspace/pi` (read-only reference)
- Plugin codebase: `/workspaces/chunkhound_workspace/pi-agenticoding`
- Design: notebook pages `model-tag-router-pi-native-data-model-design`, `model-tag-router-dynamic-mockup`
