/**
 * Readonly handoff integration tests.
 *
 * Extracted from the monolithic agenticoding.test.ts on the feat/readonly branch.
 * Covers: readonly-aware /handoff command, handoff tool enrichment,
 * compaction persistence, and turn_end status stickiness.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createState } from "../../state.js";
import { setActiveNotebookTopic } from "../../notebook/topic.js";
import { registerHandoffCommand } from "../../handoff/command.js";
import { registerHandoffTool } from "../../handoff/tool.js";
import registerAgenticoding from "../../index.js";
import { STATUS_KEY_HANDOFF } from "../../tui.js";

// ── Helpers ─────────────────────────────────────────────────────

type Handler = (args: any, ctx: any) => any;

class MockPi {
	commands = new Map<string, { description?: string; handler: Handler }>();
	tools = new Map<string, any>();
	handlers = new Map<string, Handler[]>();
	activeTools: string[] = [];
	allToolNames: string[] | undefined;
	toolSources = new Map<string, string>();
	sentUserMessages: Array<{ content: string; options: any }> = [];
	appendedEntries: Array<{ customType: string; data: any }> = [];
	flags = new Map<string, any>();
	shortcuts = new Map<string, { description?: string; handler: Handler }>();

	registerCommand(name: string, definition: { description?: string; handler: Handler }) {
		this.commands.set(name, definition);
	}

	registerTool(definition: any) {
		this.tools.set(definition.name, definition);
	}

	on(event: string, handler: Handler) {
		const handlers = this.handlers.get(event) ?? [];
		handlers.push(handler);
		this.handlers.set(event, handlers);
	}

	getActiveTools() {
		return [...this.activeTools];
	}

	setActiveTools(tools: string[]) {
		this.activeTools = [...tools];
		for (const tool of tools) {
			if (!this.toolSources.has(tool)) {
				this.toolSources.set(tool, "builtin");
			}
		}
	}

	setToolSource(name: string, source: string) {
		this.toolSources.set(name, source);
	}

	setAllTools(tools: string[]) {
		this.allToolNames = [...tools];
		for (const tool of tools) {
			if (!this.toolSources.has(tool)) {
				this.toolSources.set(tool, "builtin");
			}
		}
	}

	getAllTools() {
		return (this.allToolNames ?? this.activeTools).map((name) => ({
			name,
			description: "",
			parameters: {},
			sourceInfo: {
				path: `<${this.toolSources.get(name) ?? "builtin"}:${name}>`,
				source: this.toolSources.get(name) ?? "builtin",
				scope: "temporary",
				origin: "top-level",
			},
		}));
	}

	getThinkingLevel() {
		return "medium";
	}

	sendUserMessage(content: string, options?: any) {
		this.sentUserMessages.push({ content, options });
	}

	appendEntry(customType: string, data: any) {
		this.appendedEntries.push({ customType, data });
	}

	registerFlag(name: string, definition: { description?: string; type: string; default: any }) {
		if (!this.flags.has(name)) this.flags.set(name, definition.default);
	}

	getFlag(name: string): any {
		return this.flags.get(name);
	}

	registerShortcut(key: string, definition: { description?: string; handler: Handler }) {
		this.shortcuts.set(key, definition);
	}
}

// ── /handoff under readonly ─────────────────────────────────────────

test("/handoff under readonly creates a required handoff with readonly continuation guidance", async () => {
	const pi = new MockPi();
	const state = createState();
	state.readonlyEnabled = true;
	registerHandoffCommand(pi as any, state);

	const notifications: Array<{ message: string; level: string }> = [];
	await pi.commands.get("handoff")!.handler("implement auth", {
		hasUI: true,
		isIdle: () => true,
		ui: {
			notify: (message: string, level: string) => notifications.push({ message, level }),
		},
	});

	assert.deepEqual(state.pendingRequestedHandoff, {
		toolCalled: false,
		readonlyBypassActive: true,
		resumeReadonlyAfterHandoff: true,
		enforcementAttempts: 0,
	});
	assert.equal(notifications.length, 1);
	assert.match(notifications[0].message, /temporary handoff-only exception/i);
	assert.match(notifications[0].message, /resume in readonly mode/i);
	assert.equal(notifications[0].level, "info");
	assert.equal(pi.sentUserMessages.length, 1);
	assert.match(pi.sentUserMessages[0].content, /temporary exception allows the handoff tool/i);
	assert.match(pi.sentUserMessages[0].content, /fresh context after compaction will resume in readonly mode/i);
});

// ── Handoff tool readonly enrichment ──────────────────────────────────

test("handoff tool readonly enrichment adds Execution Constraints section", async () => {
	const pi = new MockPi();
	const state = createState();
	state.pendingRequestedHandoff = {
		toolCalled: false,
		readonlyBypassActive: true,
		resumeReadonlyAfterHandoff: true,
		enforcementAttempts: 0,
	};
	registerHandoffTool(pi as any, state);

	const result = await pi.tools.get("handoff").execute(
		"1",
		{ task: "Goal: continue" },
		undefined,
		undefined,
		{ compact: (_options: any) => {} },
	);

	assert.match(state.pendingHandoff?.task ?? "", /## Execution Constraints/);
	assert.match(state.pendingHandoff?.task ?? "", /Fresh context resumes in readonly mode/);
	assert.match(state.pendingHandoff?.task ?? "", /[Ww]rite, edit, and non-temp bash/);
	assert.match(state.pendingHandoff?.task ?? "", /temporary handoff-only exception.*no longer active/);
	assert.match(state.pendingHandoff?.task ?? "", /## Handoff — Continue Previous Work/);
	assert.match(state.pendingHandoff?.task ?? "", /Goal: continue/);
	assert.equal(result.content[0].text, "Handoff started.");
	assert.equal(result.terminate, true);
});

// ── Handoff tool success clears state ────────────────────────────────

test("handoff tool success clears pending requested handoff and active notebook topic", async () => {
	const pi = new MockPi();
	const state = createState();
	state.pendingRequestedHandoff = {
		toolCalled: false,
		readonlyBypassActive: false,
		resumeReadonlyAfterHandoff: false,
		enforcementAttempts: 0,
	};
	setActiveNotebookTopic(state, "OAuth Refresh", "human");
	registerHandoffTool(pi as any, state);

	let compactOptions: any;
	const statuses = new Map<string, string | undefined>();
	await pi.tools.get("handoff").execute(
		"1",
		{ task: "Goal: continue" },
		undefined,
		undefined,
		{
			hasUI: true,
			ui: { setStatus: (key: string, value: string | undefined) => { statuses.set(key, value); } },
			compact: (options: any) => { compactOptions = options; },
		},
	);

	assert.equal(state.pendingRequestedHandoff?.toolCalled, true);
	assert.equal(state.activeNotebookTopic, "oauth-refresh");
	compactOptions.onComplete({});

	assert.equal(state.pendingRequestedHandoff, null);
	assert.equal(state.activeNotebookTopic, null);
	assert.equal(state.activeNotebookTopicSource, null);
	assert.equal(state.pendingTopicBoundaryHint, null);
	assert.equal(statuses.get(STATUS_KEY_HANDOFF), undefined);
	assert.deepEqual(pi.sentUserMessages, [{ content: "Proceed.", options: undefined }]);
});

// ── Readonly handoff persistence across compaction ────────────────────

test("readonly requested handoff persists across compaction and rehydrates without the temporary bypass", async () => {
	const pi = new MockPi();
	registerAgenticoding(pi as any);

	const statuses = new Map<string, string | undefined>();
	const uiCtx = {
		hasUI: true,
		ui: {
			notify: () => {},
			theme: { fg: (_name: string, text: string) => text },
			setStatus: (key: string, value: string | undefined) => { statuses.set(key, value); },
			setWidget: () => {},
		},
		getContextUsage: () => null,
	};
	const handoffCommandCtx = {
		hasUI: true,
		isIdle: () => true,
		ui: {
			notify: () => {},
			theme: { fg: (_name: string, text: string) => text },
			setStatus: (key: string, value: string | undefined) => { statuses.set(key, value); },
		},
	};

	await pi.commands.get("readonly")!.handler("", uiCtx as any);
	assert.deepEqual(pi.appendedEntries, [{ customType: "agenticoding-readonly", data: { enabled: true } }]);

	await pi.commands.get("handoff")!.handler("continue readonly work", handoffCommandCtx as any);

	const [toolCallHandler] = pi.handlers.get("tool_call")!;
	const writeBeforeHandoff = await toolCallHandler({ toolName: "write", input: { path: "/tmp/test", content: "x" } }, {});
	assert.equal(writeBeforeHandoff.block, true);
	const handoffBeforeCompaction = await toolCallHandler({ toolName: "handoff", input: { task: "continue readonly work" } }, {});
	assert.equal(handoffBeforeCompaction, undefined, "temporary bypass should allow the requested handoff");

	let compactOptions: any;
	const handoffResult = await pi.tools.get("handoff").execute(
		"handoff-1",
		{ task: "Continue readonly work" },
		undefined,
		undefined,
		{
			hasUI: true,
			ui: { setStatus: (key: string, value: string | undefined) => { statuses.set(key, value); } },
			compact: (options: any) => { compactOptions = options; },
		},
	);
	assert.equal(handoffResult.content[0].text, "Handoff started.");
	assert.match(compactOptions ? "ok" : "", /ok/);

	const [sessionBeforeCompact] = pi.handlers.get("session_before_compact")!;
	const compaction = await sessionBeforeCompact(
		{ preparation: { tokensBefore: 77 }, branchEntries: [{ id: "leaf-1" }] },
		{},
	);
	assert.match(compaction.compaction.summary, /## Execution Constraints/);
	assert.match(compaction.compaction.summary, /Fresh context resumes in readonly mode/);
	compactOptions.onComplete({});

	const branch = pi.appendedEntries.map((entry, index) => ({
		id: `readonly-${index}`,
		type: "custom",
		customType: entry.customType,
		data: entry.data,
	}));
	for (const handler of pi.handlers.get("session_start") ?? []) {
		await handler({ reason: "resume" }, {
			hasUI: true,
			ui: {
				theme: { fg: (_name: string, text: string) => text },
				setStatus: (key: string, value: string | undefined) => { statuses.set(key, value); },
				setWidget: () => {},
			},
			sessionManager: { getBranch: () => branch },
			getContextUsage: () => null,
		});
	}

	assert.ok(statuses.get("agenticoding-readonly")?.includes("readonly"), "fresh context should rehydrate readonly from persisted branch state");
	const writeAfterRehydrate = await toolCallHandler({ toolName: "write", input: { path: "/tmp/test", content: "x" } }, {});
	assert.equal(writeAfterRehydrate.block, true, "write should be blocked again after readonly rehydrates");
	const blockedDirectHandoff = await toolCallHandler({ toolName: "handoff", input: { task: "direct call" } }, {});
	assert.equal(blockedDirectHandoff.block, true, "temporary handoff bypass should be cleared after compaction");
	assert.match(blockedDirectHandoff.reason, /unless the user explicitly requests \/handoff/);

	await pi.commands.get("handoff")!.handler("second readonly handoff", handoffCommandCtx as any);
	const handoffAfterExplicitRequest = await toolCallHandler({ toolName: "handoff", input: { task: "second readonly handoff" } }, {});
	assert.equal(handoffAfterExplicitRequest, undefined, "handoff should be allowed again after a fresh explicit /handoff request");
});

// ── turn_end status stickiness ──────────────────────────────────────

test("turn_end keeps requested handoff status sticky until real handoff happens", async () => {
	const pi = new MockPi();
	registerAgenticoding(pi as any);
	const statuses = new Map<string, string | undefined>();
	await pi.commands.get("handoff")!.handler("implement auth", {
		hasUI: true,
		isIdle: () => true,
		ui: {
			theme: { fg: (_name: string, text: string) => text },
			notify: () => {},
			setStatus: (key: string, value: string | undefined) => { statuses.set(key, value); },
		},
	});

	const [turnEnd] = pi.handlers.get("turn_end")!;
	await turnEnd({}, {
		hasUI: true,
		ui: {
			theme: { fg: (_name: string, text: string) => text },
			setStatus: (key: string, value: string | undefined) => { statuses.set(key, value); },
			setWidget: () => {},
		},
		getContextUsage: () => null,
	});

	assert.equal(statuses.get(STATUS_KEY_HANDOFF), "🤝 Handoff in progress");
});
