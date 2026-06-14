import test from "node:test";
import assert from "node:assert/strict";
import { createState } from "../../state.js";
import { buildNudge, registerWatchdog } from "../../watchdog.js";
import registerAgenticoding from "../../index.js";
import { createTestPI } from "./helpers.js";

// ── buildNudge readonly tests ────────────────────────────────────

test("buildNudge readonly with topic points handoff requests to readonly continuation", () => {
	const nudge = buildNudge(
		{ readonlyEnabled: true, activeNotebookTopic: "my-topic", pendingTopicBoundaryHint: null, pendingRequestedHandoff: null },
		50,
	);
	assert.match(nudge, /my-topic/);
	assert.match(nudge, /same-topic delegation/);
	assert.match(nudge, /fresh context resumes in readonly mode/i);
});

test("buildNudge readonly without topic suggests notebook_topic_set", () => {
	const nudge = buildNudge(
		{ readonlyEnabled: true, activeNotebookTopic: null, pendingTopicBoundaryHint: null, pendingRequestedHandoff: null },
		50,
	);
	assert.match(nudge, /fresh context resumes in readonly mode/i);
	assert.match(nudge, /notebook_topic_set/);
});

test("buildNudge readonly with boundary hint points to spawn vs readonly-preserving handoff", () => {
	const nudge = buildNudge(
		{ readonlyEnabled: true, activeNotebookTopic: null, pendingTopicBoundaryHint: { from: "old", to: "new", source: "agent" }, pendingRequestedHandoff: null },
		null,
	);
	assert.match(nudge, /Readonly mode is active/);
	assert.match(nudge, /current topic/);
	assert.match(nudge, /fresh context resumes in readonly mode/i);
});

test("buildNudge no longer emits the old percent-only handoff text", () => {
	const old = buildNudge({ activeNotebookTopic: "oauth", pendingTopicBoundaryHint: null, readonlyEnabled: false, pendingRequestedHandoff: null }, 46);
	assert.doesNotMatch(old, /One context, one job\.|If you're mid-job and still clear|consider a handoff and draft a clear brief/i);
	assert.match(old, /Active notebook topic: oauth/);
	assert.match(old, /prefer spawn/i);
});

test("buildNudge with pendingRequestedHandoff and resumeReadonlyAfterHandoff=true", () => {
	const nudge = buildNudge(
		{
			readonlyEnabled: true,
			activeNotebookTopic: "my-topic",
			pendingTopicBoundaryHint: null,
			pendingRequestedHandoff: {
				toolCalled: false,
				readonlyBypassActive: true,
				resumeReadonlyAfterHandoff: true,
				enforcementAttempts: 1,
			},
		},
		50,
	);
	assert.match(nudge, /User explicitly requested \/handoff/);
	assert.match(nudge, /You must complete a real handoff/);
	assert.match(nudge, /Readonly remains active/);
	assert.match(nudge, /temporary exception allows only the handoff tool/);
	assert.match(nudge, /Draft the brief for readonly continuation/);
});

test("buildNudge with pendingRequestedHandoff and resumeReadonlyAfterHandoff=false", () => {
	const nudge = buildNudge(
		{
			readonlyEnabled: false,
			activeNotebookTopic: null,
			pendingTopicBoundaryHint: null,
			pendingRequestedHandoff: {
				toolCalled: false,
				readonlyBypassActive: false,
				resumeReadonlyAfterHandoff: false,
				enforcementAttempts: 1,
			},
		},
		null,
	);
	assert.match(nudge, /User explicitly requested \/handoff/);
	assert.match(nudge, /Complete a real handoff now/);
	assert.doesNotMatch(nudge, /Readonly remains active/);
});

// ── Context injection tests ──────────────────────────────────────

test("context injects watchdog reminder before each LLM call", async () => {
	const pi = createTestPI();
	registerAgenticoding(pi as any);
	const [handler] = pi.handlers.get("context")!;
	await pi.commands.get("notebook")!.handler("oauth", { hasUI: false, getContextUsage: () => null });

	const result = await handler(
		{ messages: [{ role: "user", content: "hi", timestamp: 1 }] },
		{
			getContextUsage: () => ({ percent: 70 }),
		},
	);

	assert.equal(result.messages.length, 2);
	assert.deepEqual(result.messages[0], { role: "user", content: "hi", timestamp: 1 });
	assert.equal(result.messages[1].role, "custom");
	assert.equal(result.messages[1].customType, "agenticoding-watchdog");
	assert.equal(result.messages[1].display, false);
	assert.match(result.messages[1].content, /Context at 70%/);
	assert.match(result.messages[1].content, /Active notebook topic: oauth/);
	assert.match(result.messages[1].content, /spawn it instead of polluting the parent context/i);
	assert.doesNotMatch(result.messages[1].content, /If you're mid-job and still clear|consider a handoff and draft a clear brief for what comes next/i);
});

test("context injects a boundary nudge below 30% after an explicit topic change", async () => {
	const pi = createTestPI();
	registerAgenticoding(pi as any);
	const [handler] = pi.handlers.get("context")!;
	await pi.commands.get("notebook")!.handler("oauth", { hasUI: false, getContextUsage: () => null });
	await pi.commands.get("notebook")!.handler("billing", { hasUI: false, getContextUsage: () => null });

	const result = await handler(
		{ messages: [{ role: "user", content: "hi", timestamp: 1 }] },
		{ getContextUsage: () => ({ percent: 20 }) },
	);

	assert.equal(result.messages[1].display, false);
	assert.match(result.messages[1].content, /Notebook topic changed from oauth to billing/);
});

test("context injects a no-topic nudge when context is high", async () => {
	const pi = createTestPI();
	registerAgenticoding(pi as any);
	const [handler] = pi.handlers.get("context")!;

	const result = await handler(
		{ messages: [{ role: "user", content: "hi", timestamp: 1 }] },
		{ getContextUsage: () => ({ percent: 70 }) },
	);

	assert.equal(result.messages.length, 2);
	assert.equal(result.messages[1].role, "custom");
	assert.equal(result.messages[1].customType, "agenticoding-watchdog");
	assert.equal(result.messages[1].display, false);
	assert.match(result.messages[1].content, /No active notebook topic is set/);
	assert.match(result.messages[1].content, /Assign a fresh topic in the next clean context after handoff/i);
});

test("context consumes a boundary hint after the first injected nudge", async () => {
	const pi = createTestPI();
	registerAgenticoding(pi as any);
	const [handler] = pi.handlers.get("context")!;
	await pi.commands.get("notebook")!.handler("oauth", { hasUI: false, getContextUsage: () => null });
	await pi.commands.get("notebook")!.handler("billing", { hasUI: false, getContextUsage: () => null });

	const first = await handler(
		{ messages: [{ role: "user", content: "hi", timestamp: 1 }] },
		{ getContextUsage: () => ({ percent: 20 }) },
	);
	assert.match(first.messages[1].content, /Notebook topic changed from oauth to billing/);

	const second = await handler(
		{ messages: [{ role: "user", content: "hi", timestamp: 2 }] },
		{ getContextUsage: () => ({ percent: 20 }) },
	);
	assert.equal(second, undefined);
});

// ── Band throttling / watchdog tests ─────────────────────────────

test("watchdog nudges when crossing from band 0 to band 1 (45%→55%)", async () => {
	const pi = createTestPI();
	registerAgenticoding(pi as any);
	const [handler] = pi.handlers.get("context")!;

	// First call: 45% → band 0, should inject watchdog
	const first = await handler(
		{ messages: [{ role: "user", content: "hi", timestamp: 1 }] },
		{ getContextUsage: () => ({ percent: 45 }) },
	);
	assert.notEqual(first, undefined);
	assert.equal(first.messages[1].customType, "agenticoding-watchdog");
});

test("context throttles watchdog nudges within the same band", async () => {
	const pi = createTestPI();
	registerAgenticoding(pi as any);
	const [handler] = pi.handlers.get("context")!;

	// First call: 75% → band 2, should inject watchdog
	const first = await handler(
		{ messages: [{ role: "user", content: "hi", timestamp: 1 }] },
		{ getContextUsage: () => ({ percent: 75 }) },
	);
	assert.notEqual(first, undefined);
	assert.equal(first.messages[1].customType, "agenticoding-watchdog");

	// Second call: 78% → same band 2, should be throttled
	const second = await handler(
		{ messages: [{ role: "user", content: "hi", timestamp: 2 }] },
		{ getContextUsage: () => ({ percent: 78 }) },
	);
	assert.equal(second, undefined);
});

test("readonly nudge and watchdog nudge merge in same context turn", async () => {
	const pi = createTestPI();
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
		{ getContextUsage: () => ({ percent: 70 }), sessionManager: { getBranch: () => [] } },
	);

	// Both nudges should be present in the result
	assert.ok(result.messages.length >= 3, `expected >= 3 messages, got ${result.messages.length}`);
	const customTypes = result.messages
		.filter((m: any) => m.role === "custom")
		.map((m: any) => m.customType);
	assert.ok(customTypes.includes("agenticoding-readonly-nudge"), "should include readonly nudge");
	assert.ok(customTypes.includes("agenticoding-watchdog"), "should include watchdog nudge");
});

// ── Watchdog sticky handoff ─────────────────────────────────────

test("watchdog keeps a requested handoff sticky when it is not completed", async () => {
	const pi = createTestPI();
	const state = createState();
	state.pendingRequestedHandoff = {
		toolCalled: false,
		readonlyBypassActive: false,
		resumeReadonlyAfterHandoff: false,
		enforcementAttempts: 0,
	};
	registerWatchdog(pi as any, state);
	const [handler] = pi.handlers.get("agent_end")!;

	const notifications: string[] = [];
	await handler(
		{},
		{
			hasUI: true,
			ui: {
				notify: (message: string) => notifications.push(message),
				setStatus: () => {},
			},
			getContextUsage: () => ({ percent: 20 }),
		},
	);

	assert.equal(state.pendingRequestedHandoff?.toolCalled, false);
	assert.equal(state.pendingRequestedHandoff?.enforcementAttempts, 1);
	assert.deepEqual(notifications, []);
	assert.deepEqual(pi.sentUserMessages, []);
});

test("watchdog auto-clears pending handoff after MAX_HANDOFF_ATTEMPTS turns", async () => {
	const pi = createTestPI();
	const state = createState();
	state.pendingRequestedHandoff = {
		toolCalled: false,
		readonlyBypassActive: false,
		resumeReadonlyAfterHandoff: false,
		enforcementAttempts: 0,
	};
	registerWatchdog(pi as any, state);
	const [handler] = pi.handlers.get("agent_end")!;

	const notifications: string[] = [];
	for (let i = 0; i < 4; i++) {
		await handler(
			{},
			{
				hasUI: true,
				ui: {
					notify: (message: string) => notifications.push(message),
					setStatus: () => {},
				},
				getContextUsage: () => ({ percent: 20 }),
			},
		);
	}

	// After 4 turns, still pending, no notification yet
	assert.equal(state.pendingRequestedHandoff?.enforcementAttempts, 4);
	assert.notEqual(state.pendingRequestedHandoff, null);
	assert.deepEqual(notifications, []);

	// 5th turn hits the cap
	await handler(
		{},
		{
			hasUI: true,
			ui: {
				notify: (message: string) => notifications.push(message),
				setStatus: () => {},
			},
			getContextUsage: () => ({ percent: 20 }),
		},
	);

	assert.equal(state.pendingRequestedHandoff, null);
	assert.match(notifications[0], /cancelled after 5 turns/i);
});
