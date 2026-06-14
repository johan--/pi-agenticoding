/**
 * Readonly rehydration and session lifecycle tests.
 *
 * Extracted from the monolithic agenticoding.test.ts on the feat/readonly branch.
 * Covers: session_start rehydration, session_tree rehydration,
 * --readonly CLI flag interactions, context hook nudges, and state cleanup.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createState, resetState } from "../../state.js";
import registerAgenticoding from "../../index.js";
import { updateIndicators } from "../../tui.js";
import { createTestPI, makeTUICtx } from "./helpers.js";
import { createTestHarness } from "../test-utils.js";

// ── Helpers ─────────────────────────────────────────────────────

type Handler = (...args: any[]) => any;

/**
 * Creates a test PI with full flags support (registerFlag / getFlag / .flags),
 * matching the MockPi class from the original monolithic test file.
 */
function createMockPI() {
	const flags = new Map<string, any>();
	const pi = createTestPI() as any;
	pi.flags = flags;
	pi.registerFlag = (name: string, def: any) => {
		if (!flags.has(name)) flags.set(name, def.default);
	};
	pi.getFlag = (name: string) => flags.get(name);
	return pi;
}

// ── session_start rehydration tests ─────────────────────────────

test("session_start rehydrates readonly from branch entries", async () => {
	const pi = createMockPI();
	registerAgenticoding(pi as any);

	const statuses = new Map<string, string | undefined>();
	const branch = [
		{ type: "custom", customType: "agenticoding-readonly", data: { enabled: false } },
		{ type: "custom", customType: "agenticoding-readonly", data: { enabled: true } },
	];

	const sessionStartHandlers = pi.handlers.get("session_start")!;
	for (const handler of sessionStartHandlers) {
		await handler({ reason: "resume" }, {
			hasUI: true,
			ui: {
				theme: { fg: (_n: string, t: string) => t },
				setStatus: (key: string, val: string | undefined) => statuses.set(key, val),
				setWidget: () => {},
			},
			sessionManager: { getBranch: () => branch },
			getContextUsage: () => null,
		});
	}

	const s = statuses.get("agenticoding-readonly");
	assert.ok(s?.includes("readonly"), "readonly indicator should be shown after rehydrating true");
});

test("session_start rehydrate handles null entries in branch", async () => {
	const pi = createMockPI();
	registerAgenticoding(pi as any);

	const statuses = new Map<string, string | undefined>();
	// null entries between valid entries should not crash or affect rehydration
	const branch = [
		null,
		undefined,
		{ type: "custom", customType: "agenticoding-readonly", data: { enabled: true } },
		null,
	];

	const sessionStartHandlers = pi.handlers.get("session_start")!;
	for (const handler of sessionStartHandlers) {
		await handler({ reason: "resume" }, {
			hasUI: true,
			ui: {
				theme: { fg: (_n: string, t: string) => t },
				setStatus: (key: string, val: string | undefined) => statuses.set(key, val),
				setWidget: () => {},
			},
			sessionManager: { getBranch: () => branch },
			getContextUsage: () => null,
		});
	}

	const s = statuses.get("agenticoding-readonly");
	assert.ok(s?.includes("readonly"), "readonly should be rehydrated past null entries");
});

test("session_start rehydrate handles string entries in branch", async () => {
	const pi = createMockPI();
	registerAgenticoding(pi as any);

	const statuses = new Map<string, string | undefined>();
	const branch = ["bad-entry", { type: "custom", customType: "agenticoding-readonly", data: { enabled: true } }];

	const sessionStartHandlers = pi.handlers.get("session_start")!;
	for (const handler of sessionStartHandlers) {
		await handler({ reason: "resume" }, {
			hasUI: true,
			ui: {
				theme: { fg: (_n: string, t: string) => t },
				setStatus: (key: string, val: string | undefined) => statuses.set(key, val),
				setWidget: () => {},
			},
			sessionManager: { getBranch: () => branch },
			getContextUsage: () => null,
		});
	}

	const s = statuses.get("agenticoding-readonly");
	assert.ok(s?.includes("readonly"), "readonly should be rehydrated past string entries");
});

test("--readonly CLI flag takes precedence when branch has only malformed entries", async () => {
	const pi = createMockPI();
	pi.flags.set("readonly", true);
	registerAgenticoding(pi as any);

	const statuses = new Map<string, string | undefined>();
	// Entry has customType but missing type:"custom" — should not count as a valid branch entry
	const branch = [
		{ customType: "agenticoding-readonly" },
	];

	const sessionStartHandlers = pi.handlers.get("session_start")!;
	for (const handler of sessionStartHandlers) {
		await handler({ reason: "resume" }, {
			hasUI: true,
			ui: {
				theme: { fg: (_n: string, t: string) => t },
				setStatus: (key: string, val: string | undefined) => statuses.set(key, val),
				setWidget: () => {},
			},
			sessionManager: { getBranch: () => branch },
			getContextUsage: () => null,
		});
	}

	const s = statuses.get("agenticoding-readonly");
	assert.ok(s?.includes("readonly"), "CLI flag should win when branch has only malformed entries");
});

test("session_start clears readonly indicator on /new", async () => {
	const pi = createMockPI();
	registerAgenticoding(pi as any);

	const statuses = new Map<string, string | undefined>();

	// First: enable readonly via command
	await pi.commands.get("readonly")!.handler("", {
		hasUI: true,
		ui: {
			notify: () => {},
			theme: { fg: (_n: string, t: string) => t },
			setStatus: (key: string, val: string | undefined) => statuses.set(key, val),
			setWidget: () => {},
		},
		getContextUsage: () => null,
	});

	assert.ok(statuses.get("agenticoding-readonly")?.includes("readonly"));

	// Now: /new should clear it
	const sessionStartHandlers = pi.handlers.get("session_start")!;
	for (const handler of sessionStartHandlers) {
		await handler({ reason: "new" }, {
			hasUI: true,
			ui: {
				theme: { fg: (_n: string, t: string) => t },
				setStatus: (key: string, val: string | undefined) => statuses.set(key, val),
				setWidget: () => {},
			},
			sessionManager: { getBranch: () => [] },
			getContextUsage: () => null,
		});
	}

	assert.equal(statuses.get("agenticoding-readonly"), undefined, "readonly indicator should be cleared on /new");
});

test("--readonly CLI flag does not override branch state when branch has entries", async () => {
	const pi = createMockPI();
	pi.flags.set("readonly", true);
	registerAgenticoding(pi as any);

	const statuses = new Map<string, string | undefined>();
	const branch = [
		{ type: "custom", customType: "agenticoding-readonly", data: { enabled: false } },
	];

	const sessionStartHandlers = pi.handlers.get("session_start")!;
	for (const handler of sessionStartHandlers) {
		await handler({ reason: "resume" }, {
			hasUI: true,
			ui: {
				theme: { fg: (_n: string, t: string) => t },
				setStatus: (key: string, val: string | undefined) => statuses.set(key, val),
				setWidget: () => {},
			},
			sessionManager: { getBranch: () => branch },
			getContextUsage: () => null,
		});
	}

	// Branch has an explicit OFF entry; CLI flag only applies when no entries exist.
	const s = statuses.get("agenticoding-readonly");
	assert.equal(s, undefined, "branch state should win over CLI flag");
});

test("--readonly CLI flag applies on session_start for new sessions", async () => {
	const pi = createMockPI();
	pi.flags.set("readonly", true);
	registerAgenticoding(pi as any);

	const statuses = new Map<string, string | undefined>();
	const sessionStartHandlers = pi.handlers.get("session_start")!;
	for (const handler of sessionStartHandlers) {
		await handler({ reason: "new" }, {
			hasUI: true,
			ui: {
				theme: { fg: (_n: string, t: string) => t },
				setStatus: (key: string, val: string | undefined) => statuses.set(key, val),
				setWidget: () => {},
			},
			sessionManager: { getBranch: () => [] },
			getContextUsage: () => null,
		});
	}

	assert.ok(statuses.get("agenticoding-readonly")?.includes("readonly"));
});

test("session_start clears stale readonly state on resume when the branch has no readonly entry", async () => {
	const pi = createMockPI();
	registerAgenticoding(pi as any);

	const statuses = new Map<string, string | undefined>();
	await pi.commands.get("readonly")!.handler("", {
		hasUI: true,
		ui: {
			notify: () => {},
			theme: { fg: (_n: string, t: string) => t },
			setStatus: (key: string, val: string | undefined) => statuses.set(key, val),
			setWidget: () => {},
		},
		getContextUsage: () => null,
	});
	assert.ok(statuses.get("agenticoding-readonly")?.includes("readonly"));

	const sessionStartHandlers = pi.handlers.get("session_start")!;
	for (const handler of sessionStartHandlers) {
		await handler({ reason: "resume" }, {
			hasUI: true,
			ui: {
				theme: { fg: (_n: string, t: string) => t },
				setStatus: (key: string, val: string | undefined) => statuses.set(key, val),
				setWidget: () => {},
			},
			sessionManager: { getBranch: () => [] },
			getContextUsage: () => null,
		});
	}

	assert.equal(statuses.get("agenticoding-readonly"), undefined);
});

// ── Readonly mode: context hook nudges ──────────────────────────

test("readonly ON nudge is delivered via context hook", async () => {
	const pi = createMockPI();
	registerAgenticoding(pi as any);

	// Toggle readonly ON
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

	const [contextHandler] = pi.handlers.get("context")!;
	const result = await contextHandler(
		{ messages: [{ role: "user", content: "hi", timestamp: 1 }] },
		{ getContextUsage: () => ({ percent: 10 }), sessionManager: { getBranch: () => [] } },
	);

	assert.equal(result.messages.length, 2);
	assert.equal(result.messages[1].customType, "agenticoding-readonly-nudge");
	assert.match(result.messages[1].content, /Readonly mode is active/);
});

test("readonly OFF nudge is delivered when the current tree has a prior ON entry", async () => {
	const pi = createMockPI();
	registerAgenticoding(pi as any);

	// Toggle ON then OFF
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

	const branch = [
		{ type: "custom", customType: "agenticoding-readonly", data: { enabled: true } },
		{ type: "custom", customType: "agenticoding-readonly", data: { enabled: false } },
	];
	const [contextHandler] = pi.handlers.get("context")!;
	const result = await contextHandler(
		{ messages: [{ role: "user", content: "hi", timestamp: 1 }] },
		{ getContextUsage: () => ({ percent: 10 }), sessionManager: { getBranch: () => branch } },
	);

	assert.equal(result.messages[1].customType, "agenticoding-readonly-nudge");
	assert.match(result.messages[1].content, /turned off/);
});

test("readonly OFF nudge is delivered after an explicit disable", async () => {
	const pi = createMockPI();
	registerAgenticoding(pi as any);

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

	const [contextHandler] = pi.handlers.get("context")!;
	const result = await contextHandler(
		{ messages: [{ role: "user", content: "hi", timestamp: 1 }] },
		{ getContextUsage: () => ({ percent: 10 }), sessionManager: { getBranch: () => [] } },
	);

	assert.ok(result && "messages" in result);
	assert.match((result as any).messages.at(-1).content, /turned off/);
});

test("readonly OFF nudge includes a handoff hint after high-context disable", async () => {
	const pi = createMockPI();
	registerAgenticoding(pi as any);

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

	const branch = [
		{ type: "custom", customType: "agenticoding-readonly", data: { enabled: true } },
		{ type: "custom", customType: "agenticoding-readonly", data: { enabled: false } },
	];
	const [contextHandler] = pi.handlers.get("context")!;
	const result = await contextHandler(
		{ messages: [{ role: "user", content: "hi", timestamp: 1 }] },
		{ getContextUsage: () => ({ percent: 61 }), sessionManager: { getBranch: () => branch } },
	);

	assert.match(result.messages[1].content, /Context was at 61%/);
	assert.match(result.messages[1].content, /if the work changed topics, you can handoff now/);
});

test("readonly nudge is one-shot — not re-delivered on subsequent calls", async () => {
	const pi = createMockPI();
	registerAgenticoding(pi as any);

	// Toggle readonly ON
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

	const [contextHandler] = pi.handlers.get("context")!;

	// First call: delivers ON nudge
	await contextHandler(
		{ messages: [{ role: "user", content: "hi", timestamp: 1 }] },
		{ getContextUsage: () => ({ percent: 10 }), sessionManager: { getBranch: () => [] } },
	);

	// Second call: no nudge
	const result = await contextHandler(
		{ messages: [{ role: "user", content: "hi", timestamp: 2 }] },
		{ getContextUsage: () => ({ percent: 10 }), sessionManager: { getBranch: () => [] } },
	);

	assert.equal(result, undefined, "nudge should not be re-delivered");
});

// ── session_tree rehydration tests ──────────────────────────────

test("session_tree rehydrates readonly from branch", async () => {
	const pi = createMockPI();
	registerAgenticoding(pi as any);

	const statuses = new Map<string, string | undefined>();
	const branch = [
		{ type: "custom", customType: "agenticoding-readonly", data: { enabled: true } },
	];

	const [sessionTreeHandler] = pi.handlers.get("session_tree")!;
	await sessionTreeHandler({}, {
		hasUI: true,
		ui: {
			theme: { fg: (_n: string, t: string) => t },
			setStatus: (key: string, val: string | undefined) => statuses.set(key, val),
			setWidget: () => {},
		},
		sessionManager: { getBranch: () => branch },
		getContextUsage: () => null,
	});

	const s = statuses.get("agenticoding-readonly");
	assert.ok(s?.includes("readonly"), "session_tree should rehydrate readonly");
});

test("session_tree rehydrates readonly-off nudge after branch change", async () => {
	const pi = createMockPI();
	registerAgenticoding(pi as any);

	const statuses = new Map<string, string | undefined>();
	const [sessionTreeHandler] = pi.handlers.get("session_tree")!;
	const [contextHandler] = pi.handlers.get("context")!;

	await pi.commands.get("readonly")!.handler("", {
		hasUI: true,
		ui: {
			notify: () => {},
			theme: { fg: (_n: string, t: string) => t },
			setStatus: (key: string, val: string | undefined) => statuses.set(key, val),
			setWidget: () => {},
		},
		getContextUsage: () => ({ percent: 12 }),
	});

	await sessionTreeHandler({}, {
		hasUI: true,
		ui: {
			theme: { fg: (_n: string, t: string) => t },
			setStatus: (key: string, val: string | undefined) => statuses.set(key, val),
			setWidget: () => {},
		},
		sessionManager: { getBranch: () => [] },
		getContextUsage: () => ({ percent: 12 }),
	});
	assert.equal(statuses.get("agenticoding-readonly"), undefined);

	const result = await contextHandler(
		{ messages: [{ role: "user", content: "hi", timestamp: 1 }] },
		{ getContextUsage: () => ({ percent: 12 }), sessionManager: { getBranch: () => [] } },
	);
	assert.ok(result && "messages" in result);
	assert.match((result as any).messages.at(-1).content, /turned off/);
});

test("session_tree reapplies --readonly and clears stale readonly on no-entry branches", async () => {
	const pi = createMockPI();
	registerAgenticoding(pi as any);

	const statuses = new Map<string, string | undefined>();
	await pi.commands.get("readonly")!.handler("", {
		hasUI: true,
		ui: {
			notify: () => {},
			theme: { fg: (_n: string, t: string) => t },
			setStatus: (key: string, val: string | undefined) => statuses.set(key, val),
			setWidget: () => {},
		},
		getContextUsage: () => null,
	});
	assert.ok(statuses.get("agenticoding-readonly")?.includes("readonly"));

	const [sessionTreeHandler] = pi.handlers.get("session_tree")!;
	await sessionTreeHandler({}, {
		hasUI: true,
		ui: {
			theme: { fg: (_n: string, t: string) => t },
			setStatus: (key: string, val: string | undefined) => statuses.set(key, val),
			setWidget: () => {},
		},
		sessionManager: { getBranch: () => [] },
		getContextUsage: () => null,
	});
	assert.equal(statuses.get("agenticoding-readonly"), undefined, "no-entry branch should clear stale readonly");

	pi.flags.set("readonly", true);
	await sessionTreeHandler({}, {
		hasUI: true,
		ui: {
			theme: { fg: (_n: string, t: string) => t },
			setStatus: (key: string, val: string | undefined) => statuses.set(key, val),
			setWidget: () => {},
		},
		sessionManager: { getBranch: () => [] },
		getContextUsage: () => null,
	});
	assert.ok(statuses.get("agenticoding-readonly")?.includes("readonly"), "CLI flag should win during session_tree rehydration");
});

test("--readonly rehydration does not append synthetic history entries", async () => {
	const pi = createMockPI();
	pi.flags.set("readonly", true);
	registerAgenticoding(pi as any);

	const ctx = {
		hasUI: true,
		ui: {
			theme: { fg: (_n: string, t: string) => t },
			setStatus: () => {},
			setWidget: () => {},
		},
		sessionManager: { getBranch: () => [] },
		getContextUsage: () => null,
	};

	for (const handler of pi.handlers.get("session_start")!) {
		await handler({ reason: "resume" }, ctx as any);
	}
	const [sessionTreeHandler] = pi.handlers.get("session_tree")!;
	await sessionTreeHandler({}, ctx as any);

	assert.equal(pi.appendedEntries.length, 0);
});

test("resetState clears readonly fields", () => {
	const state = createState();
	state.readonlyEnabled = true;
	state.readonlyNudgePending = true;
	resetState(state);
	assert.equal(state.readonlyEnabled, false);
	assert.equal(state.readonlyNudgePending, false);
});

// ── Notebook rehydration ─────────────────────────────────────────

test("notebook rehydration handles null and malformed entries in branch", async () => {
	const pi = createMockPI();
	const state = createState();
	const { registerNotebookRehydration } = await import("../../notebook/rehydration.js");
	registerNotebookRehydration(pi as any, state);
	const [handler] = pi.handlers.get("session_start")!;

	await handler(
		{},
		{
			sessionManager: {
				getBranch: () => [
					null,
					undefined,
					"bad-string",
					{ type: "custom", customType: "notebook-entry", data: { epoch: 1, name: "keep", content: "valid" } },
					null,
					{ customType: "notebook-entry" }, // missing type: "custom"
				],
			},
		},
	);

	assert.equal(state.epoch, 1);
	assert.deepEqual(Array.from(state.notebookPages.entries()), [["keep", "valid"]]);
});

// ── /notebook topic readonly warning ─────────────────────────────

test("/notebook <topic> warns with readonly-safe guidance on boundary change", async () => {
	const pi = createMockPI();
	registerAgenticoding(pi as any);
	const notifications: Array<{ message: string; level: string }> = [];
	const ctx = {
		hasUI: true,
		getContextUsage: () => ({ percent: 20 }),
		ui: {
			theme: { fg: (_name: string, text: string) => text },
			notify: (message: string, level: string) => { notifications.push({ message, level }); },
			setStatus: () => {},
			setWidget: () => {},
		},
	};

	await pi.commands.get("readonly")!.handler("", ctx as any);
	await pi.commands.get("notebook")!.handler("oauth", ctx as any);
	await pi.commands.get("notebook")!.handler("billing", ctx as any);

	assert.match(notifications[2].message, /use spawn only for same-topic delegation/);
	assert.match(notifications[2].message, /fresh context resumes in readonly mode/);
	assert.equal(notifications[2].level, "warning");
});

// ── truncateText multi-byte ──────────────────────────────────────

test("truncateText handles multi-byte boundary correctly", async () => {
	const { truncateText } = await import("../../spawn/index.js");

	// Mid-multi-byte boundary: 4-byte emoji truncated at byte 2 — should shrink to 0 bytes
	assert.equal(truncateText("🙂", 10, 2), "");

	// Exact boundary at multi-byte start: 4-byte emoji, maxBytes=4 — should keep full emoji
	assert.equal(truncateText("🙂", 10, 4), "🙂");

	// Empty input: returns empty string
	assert.equal(truncateText("", 10, 1024), "");

	// Under-limit text: returns unchanged
	assert.equal(truncateText("hello", 10, 1024), "hello");
});
