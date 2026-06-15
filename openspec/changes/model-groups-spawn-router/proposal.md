# Proposal: model-groups-spawn-router

## Goal / Context

The completed Model Groups CRUD story gives operators durable named groups of concrete models. This change makes those groups usable by the existing `spawn` tool while keeping spawn's primary UX natural and low-friction.

Operators should be able to ask in plain language, e.g. “spawn a review agent to inspect this change with the review group,” or use editor sugar like `#review`. The LLM receives a names-only list of effective groups and calls `spawn` with `group: "review"` when it can map the request confidently. The spawn tool then resolves the group to one concrete authenticated model entry, creates an isolated child session on that model, and renders routing details in the result.

## Story Candidates

Single story — first spawn-router release for Model Groups.

## Decisions & Constraints

- Spawn tool parameter shape becomes `prompt` plus optional `group?: string`; the advertised `thinking` override is removed.
- Stale tool calls that still include `thinking` are tolerated but ignored.
- If `group` is omitted, spawn keeps current behavior: inherit parent model and parent thinking.
- Effective groups follow the existing data-layer rule: project groups override same-name global groups; only effective names are exposed to the LLM.
- Prompt exposure is names-only; no provider/model entries or auth details are injected into the system prompt.
- Natural-language routing is best-effort and LLM-mediated. If no known/confident group is requested, omit `group` and inherit the parent model.
- `#group-name` autocomplete is editor sugar only. It helps the operator mention a group; it is not a parser, command syntax, or control plane.
- No interactive spawn-time picker in this MVP.
- Group resolution lives in `model-groups/router.ts`.
- Randomly select one available/authenticated entry per spawn call. Parallel calls draw independently. Once selected, do not re-roll during later provider/session retry handling.
- Thinking resolution: selected entry `thinkingLevel` wins; absent entry thinking inherits parent thinking; always clamp to the selected model capability.
- Unknown group names fall back to parent model/thinking. Known groups that are empty or contain no usable authenticated models fail clearly.
- Child execution should prefer the parent session's `ctx.modelRegistry` and its `authStorage` so runtime/session-only auth, custom providers, and headers are preserved; keep child session manager/messages/tools isolated.
- Result UI: default stays `model • thinking`; routed result is `group → provider/model • thinking`; unknown fallback is `group? fallback → provider/model • thinking`.

## Out of Scope

- Interactive picker or chooser at spawn time.
- Automatic routing when the operator did not express group intent.
- Registering groups as Pi model picker entries / meta-model proxy.
- Child profiles, frontmatter, prompts, tools, or context policies.
- Advanced policies: weights, health scoring, budget routing, failover retry fallback, rate-limit handling, or ordered priority semantics.
- Explicit provider/model override params on `spawn`.

## External Resources

- Initiative: `openspec/initiatives/model-tag-router/initiative.md`
- Prior story: `openspec/changes/model-groups-data-layer-tui/`
- Plugin codebase: `/workspaces/chunkhound_workspace/pi-agenticoding`
- Relevant code: `spawn/index.ts`, `spawn/renderer.ts`, `spawn/shared.ts`, `model-groups/store.ts`, `model-groups/types.ts`, `index.ts`, `system-prompt.ts`
- Research notebook: `spawn-model-groups-router-research`
