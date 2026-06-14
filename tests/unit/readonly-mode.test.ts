import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { createState, resetState } from "../../state.js";
import registerAgenticoding from "../../index.js";
import { STATUS_KEY_READONLY, WIDGET_KEY_WARNING, updateIndicators } from "../../tui.js";
import { createTestPI, makeTUICtx } from "./helpers.js";
import { createTestHarness } from "../test-utils.js";
import { canUseOsSandbox } from "../../os-sandbox.js";

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

// ── Readonly toggle tests ─────────────────────────────────────────

test("readonly toggle command enables and disables readonly mode", () => {
	const pi = new MockPi();
	registerAgenticoding(pi as any);

	const state = createState();
	const notifications: string[] = [];
	const statuses = new Map<string, string | undefined>();

	const ctx = {
		hasUI: true,
		ui: {
			notify: (msg: string, _type: string) => notifications.push(msg),
			theme: { fg: (_n: string, t: string) => t },
			setStatus: (key: string, val: string | undefined) => statuses.set(key, val),
			setWidget: () => {},
		},
		getContextUsage: () => null,
		sessionManager: { getBranch: () => [] },
	};

	// First toggle: ON
	pi.commands.get("readonly")!.handler("", ctx);
	assert.equal(notifications.pop(), "Readonly mode enabled — write/edit and non-temp bash writes blocked; handoff stays blocked unless the user explicitly requests /handoff");
	assert.ok(statuses.get("agenticoding-readonly")?.includes("readonly"));

	// Second toggle: OFF
	pi.commands.get("readonly")!.handler("", ctx);
	assert.equal(notifications.pop(), "Readonly mode disabled — write/edit/handoff and non-temp bash writes unblocked");
	assert.equal(statuses.get("agenticoding-readonly"), undefined);
});

test("readonly toggle while /handoff is pending keeps handoff tool accessible", async () => {
	const pi = new MockPi();
	registerAgenticoding(pi as any);

	const uiCtx = {
		hasUI: true,
		ui: {
			notify: () => {},
			theme: { fg: (_n: string, t: string) => t },
			setStatus: () => {},
			setWidget: () => {},
		},
		getContextUsage: () => null,
	};

	const handoffCtx = { hasUI: true, isIdle: () => true, ui: { notify: () => {}, theme: { fg: (_n: string, t: string) => t }, setStatus: () => {} } };

	// Enable readonly and request handoff
	pi.commands.get("readonly")!.handler("", uiCtx);
	pi.commands.get("handoff")!.handler("implement auth", handoffCtx as any);

	const [toolCallHandler] = pi.handlers.get("tool_call")!;

	// Toggle readonly OFF — readonly gone, handoff should pass through (early return)
	pi.commands.get("readonly")!.handler("", uiCtx);
	let result = await toolCallHandler({ toolName: "handoff", input: { task: "test" } }, {});
	assert.equal(result, undefined, "handoff allowed when readonly is off");

	// Toggle readonly ON — bypass active from handoff command, handoff still passes
	pi.commands.get("readonly")!.handler("", uiCtx);
	result = await toolCallHandler({ toolName: "handoff", input: { task: "test" } }, {});
	assert.equal(result, undefined, "handoff allowed when readonly is on and bypass is active");

	// Sanity: write is still blocked
	const writeResult = await toolCallHandler({ toolName: "write", input: { path: "/tmp/test" } }, {});
	assert.equal(writeResult.block, true);
	assert.match(writeResult.reason, /write\/edit disabled/);
});

test("readonly toggle is a no-op in headless mode", async () => {
	const pi = new MockPi();
	registerAgenticoding(pi as any);

	const state = createState();
	const ctx = {
		hasUI: false,
		ui: {
			notify: () => { throw new Error("should not be called in headless"); },
			theme: { fg: (_n: string, t: string) => t },
			setStatus: () => { throw new Error("should not be called in headless"); },
			setWidget: () => { throw new Error("should not be called in headless"); },
		},
		getContextUsage: () => null,
	};

	// Toggle in headless mode should not crash and should not change state
	pi.commands.get("readonly")!.handler("", ctx);
	// Verify readonly was NOT enabled — write should not be blocked
	const [toolCallHandler] = pi.handlers.get("tool_call")!;
	const result = await toolCallHandler(
		{ toolName: "write", input: { path: "/tmp/test", content: "" } },
		{ cwd: "/workspace" },
	);
	assert.equal(result, undefined, "write is not blocked after headless readonly toggle");
});

// ── Readonly TUI indicator tests ──────────────────────────────────

test("readonly TUI indicator shows warning tone when enabled", () => {
	const state = createState();
	state.readonlyEnabled = true;
	const record = { statuses: new Map<string, string | undefined>(), widgets: new Map<string, string[] | undefined>() };
	const ctx = makeTUICtx({ percent: null, record });

	updateIndicators(ctx, state);
	const s = record.statuses.get("agenticoding-readonly");
	assert.ok(s?.includes("🔒 readonly"), `expected readonly indicator, got: ${s}`);
});

test("readonly TUI indicator is cleared when disabled", () => {
	const state = createState();
	state.readonlyEnabled = false;
	const record = { statuses: new Map<string, string | undefined>(), widgets: new Map<string, string[] | undefined>() };
	const ctx = makeTUICtx({ percent: null, record });

	updateIndicators(ctx, state);
	assert.equal(record.statuses.get("agenticoding-readonly"), undefined);
});

// ── Readonly mode: tool_call blocking tests ────────────────────────

test("readonly tool_call blocks write/edit and blocks handoff unless explicitly requested", async () => {
	const pi = new MockPi();
	registerAgenticoding(pi as any);

	// Toggle readonly ON via command (modifies internal state)
	await pi.commands.get("readonly")!.handler("", {
		hasUI: true,
		ui: {
			notify: () => {},
			theme: { fg: (_n: string, t: string) => t },
			setStatus: () => {},
			setWidget: () => {},
		},
		getContextUsage: () => null,
	});

	const [toolCallHandler] = pi.handlers.get("tool_call")!;

	const writeResult = await toolCallHandler({ toolName: "write", input: { path: "/tmp/test" } }, {});
	assert.equal(writeResult.block, true);
	assert.match(writeResult.reason, /write\/edit disabled/);

	const editResult = await toolCallHandler({ toolName: "edit", input: { path: "/tmp/test" } }, {});
	assert.equal(editResult.block, true);

	const blockedHandoff = await toolCallHandler({ toolName: "handoff", input: { task: "test" } }, {});
	assert.equal(blockedHandoff.block, true);
	assert.match(blockedHandoff.reason, /unless the user explicitly requests \/handoff/);

	// Simulate /handoff command — activates bypass
	await pi.commands.get("handoff")!.handler("implement auth", {
		hasUI: true,
		isIdle: () => true,
		ui: {
			notify: () => {},
			theme: { fg: (_n: string, t: string) => t },
			setStatus: () => {},
		},
	});

	const allowedHandoff = await toolCallHandler({ toolName: "handoff", input: { task: "test" } }, {});
	assert.equal(allowedHandoff, undefined);

	const readResult = await toolCallHandler({ toolName: "read", input: { path: "/tmp/test" } }, {});
	assert.equal(readResult, undefined);
});

test("normal tool_call does not block ordinary write/edit calls", async () => {
	const pi = new MockPi();
	registerAgenticoding(pi as any);

	const [toolCallHandler] = pi.handlers.get("tool_call")!;

	const writeResult = await toolCallHandler(
		{ toolName: "write", input: { path: "/tmp/test.txt", content: "hello" } },
		{},
	);
	assert.equal(writeResult, undefined, "write should pass through when readonly is off");

	const editResult = await toolCallHandler(
		{ toolName: "edit", input: { path: "/tmp/test.txt", edits: [] } },
		{},
	);
	assert.equal(editResult, undefined, "edit should pass through when readonly is off");
});


test("readonly tool_call does not block bash when readonly is off", async () => {
	const pi = new MockPi();
	registerAgenticoding(pi as any);

	const [toolCallHandler] = pi.handlers.get("tool_call")!;

	// Bash not blocked when readonly is off
	const safeResult = await toolCallHandler({ toolName: "bash", input: { command: "rm -rf /" } }, {});
	assert.equal(safeResult, undefined, "should not block when readonly is off");
});

test("readonly tool_call blocks non-temp bash writes when readonly is on", async () => {
	const pi = new MockPi();
	registerAgenticoding(pi as any);

	const [toolCallHandler] = pi.handlers.get("tool_call")!;

	// Toggle readonly ON via command
	const notifications: string[] = [];
	const statuses = new Map<string, string | undefined>();
	await pi.commands.get("readonly")!.handler("", {
		hasUI: true,
		ui: {
			notify: (msg: string) => notifications.push(msg),
			theme: { fg: (_n: string, t: string) => t },
			setStatus: (key: string, val: string | undefined) => statuses.set(key, val),
			setWidget: () => {},
		},
		getContextUsage: () => null,
	});

	const blockedInput = { command: "rm -rf /" };
	const blockedResult = await toolCallHandler({ toolName: "bash", input: blockedInput }, { cwd: "/workspace" });

	if (canUseOsSandbox()) {
		// OS-level sandbox is available, but classifyBashCommand pre-blocks
		// known dangerous commands (rm, mv, etc.) before the sandbox wraps.
		// The sandbox only handles commands with unrecognized file-target paths.
		assert.equal(blockedResult.block, true);
		assert.match(blockedResult.reason, /outside temp dir/);
	} else {
		// Fallback: classifyBashCommand blocks
		assert.equal(blockedResult.block, true);
		assert.match(blockedResult.reason, /outside temp dir/);
	}

	const tempAllowedInput = { command: `rm ${os.tmpdir()}/x` };
	const tempAllowed = await toolCallHandler({ toolName: "bash", input: tempAllowedInput }, { cwd: "/workspace" });
	assert.equal(tempAllowed, undefined);

	const mktempAllowed = await toolCallHandler(
		{ toolName: "bash", input: { command: 'f=$(mktemp --tmpdir pi.XXXX); echo hi > "$f"' } },
		{ cwd: "/workspace" },
	);
	assert.equal(mktempAllowed, undefined);

	const mktempBlocked = await toolCallHandler(
		{ toolName: "bash", input: { command: 'f=$(mktemp --tmpdir workspace pi.XXXX); echo hi > "$f"' } },
		{ cwd: "/workspace" },
	);
	assert.ok(mktempBlocked, "relative --tmpdir flow should be blocked");
	assert.equal(mktempBlocked.block, true);
	assert.match(mktempBlocked.reason, /outside temp dir/);

	const safeInput = { command: "ls -la" };
	const safeResult = await toolCallHandler({ toolName: "bash", input: safeInput }, { cwd: "/workspace" });
	assert.equal(safeResult, undefined);

	const blankInput = { command: "   " };
	const blankResult = await toolCallHandler({ toolName: "bash", input: blankInput }, { cwd: "/workspace" });
	assert.equal(blankResult, undefined);
});

test("readonly tool_call blocks malformed bash input", async () => {
	const pi = new MockPi();
	registerAgenticoding(pi as any);

	const [toolCallHandler] = pi.handlers.get("tool_call")!;
	const notifications: string[] = [];
	const statuses = new Map<string, string | undefined>();

	// Toggle readonly ON via command
	await pi.commands.get("readonly")!.handler("", {
		hasUI: true,
		ui: {
			notify: (msg: string) => notifications.push(msg),
			theme: { fg: (_n: string, t: string) => t },
			setStatus: (key: string, val: string | undefined) => statuses.set(key, val),
			setWidget: () => {},
		},
		getContextUsage: () => null,
	});

	// Missing command property
	const missingCmd = await toolCallHandler({ toolName: "bash", input: {} }, { cwd: "/workspace" });
	assert.ok(missingCmd, "should block bash with missing command");
	assert.equal(missingCmd.block, true);
	assert.match(missingCmd.reason, /invalid bash command input/);

	// Non-string command input
	const numCmd = await toolCallHandler({ toolName: "bash", input: { command: 42 } }, { cwd: "/workspace" });
	assert.ok(numCmd, "should block bash with non-string command");
	assert.equal(numCmd.block, true);
	assert.match(numCmd.reason, /invalid bash command input/);
});

// ── Readonly state reset tests ──────────────────────────────────────

test("resetState clears readonly fields", () => {
	const state = createState();
	state.readonlyEnabled = true;
	state.readonlyNudgePending = true;
	resetState(state);
	assert.equal(state.readonlyEnabled, false);
	assert.equal(state.readonlyNudgePending, false);
});

// ── Readonly shortcut tests ────────────────────────────────────────

test("readonly shortcut is registered and gated on isIdle", async () => {
	const pi = new MockPi();
	registerAgenticoding(pi as any);

	assert.ok(pi.shortcuts.has("ctrl+shift+r"), "shortcut should be registered");

	const shortcut = pi.shortcuts.get("ctrl+shift+r")!;

	// isIdle = false: should not toggle
	const statuses = new Map<string, string | undefined>();
	await shortcut.handler({
		isIdle: () => false,
		hasUI: true,
		ui: {
			notify: () => {},
			theme: { fg: (_n: string, t: string) => t },
			setStatus: (key: string, val: string | undefined) => statuses.set(key, val),
			setWidget: () => {},
		},
		getContextUsage: () => null,
	});
	assert.equal(statuses.get("agenticoding-readonly"), undefined, "should not toggle when not idle");

	// isIdle = true: should toggle
	await shortcut.handler({
		isIdle: () => true,
		hasUI: true,
		ui: {
			notify: () => {},
			theme: { fg: (_n: string, t: string) => t },
			setStatus: (key: string, val: string | undefined) => statuses.set(key, val),
			setWidget: () => {},
		},
		getContextUsage: () => null,
	});
	assert.ok(statuses.get("agenticoding-readonly")?.includes("readonly"), "should toggle when idle");
});

// ── Readonly appendEntry persistence ────────────────────────────────

test("readonly toggle persists entry via appendEntry", () => {
	const pi = new MockPi();
	registerAgenticoding(pi as any);

	pi.commands.get("readonly")!.handler("", {
		hasUI: true,
		ui: {
			notify: () => {},
			theme: { fg: (_n: string, t: string) => t },
			setStatus: () => {},
			setWidget: () => {},
		},
		getContextUsage: () => null,
	});

	assert.equal(pi.appendedEntries.length, 1);
	assert.equal(pi.appendedEntries[0].customType, "agenticoding-readonly");
	assert.equal(pi.appendedEntries[0].data.enabled, true);
});

// ── Readonly high-context TUI guidance ──────────────────────────────

test("updateIndicators uses readonly-specific high-context guidance", () => {
	const state = createState();
	state.readonlyEnabled = true;
	const record = { statuses: new Map<string, string | undefined>(), widgets: new Map<string, string[] | undefined>() };
	const ctx = makeTUICtx({ percent: 85, record });

	updateIndicators(ctx, state);
	const w = record.widgets.get("agenticoding-warning");
	assert.ok(w?.[0]?.includes("readonly: same topic → spawn"));
	assert.ok(w?.[0]?.includes("use /handoff for a real pivot"));
	assert.ok(w?.[0]?.includes("fresh context resumes readonly"));
});
