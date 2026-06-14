import test, { after, before } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createEditTool, createWriteTool } from "@earendil-works/pi-coding-agent";
import { createState, resetState } from "../../state.js";
import { registerSpawnTool } from "../../spawn/index.js";
import { createTestHarness, type TestHarness } from "../test-utils.js";
import { canUseOsSandbox } from "../../os-sandbox.js";

type Handler = (args: any, ctx: any) => any;

class MockPi {
	commands = new Map<string, { description?: string; handler: Handler }>();
	tools = new Map<string, any>();
	handlers = new Map<string, Handler[]>();
	activeTools: string[] = [];
	allToolNames: string[] | undefined;
	toolSources = new Map<string, string>();

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
}

let h: TestHarness;

before(() => {
	h = createTestHarness();
});

after(() => {
	h.teardown();
});

// ── Readonly spawn propagation tests ──────────────────────────────

test("spawn filters write and edit from child tools when readonly is on", async () => {
	const pi = new MockPi();
	pi.setActiveTools(["read", "bash", "write", "edit", "spawn"]);
	const state = createState();
	state.readonlyEnabled = true;

	let seenTools: string[] = [];
	const mockFactory = async (config: any) => {
		seenTools = config.tools;
		const session = {
			messages: [] as any[],
			prompt: async (prompt: string) => {
				session.messages = [{ role: "assistant", content: [{ type: "text", text: "done" }] }];
			},
			abort: async () => {},
			getSessionStats: () => undefined,
		};
		return { session: session as any };
	};

	registerSpawnTool(pi as any, state, mockFactory as any);
	await pi.tools.get("spawn").execute(
		"spawn-1",
		{ prompt: "Do the task" },
		undefined,
		undefined,
		{ model: { id: "mock-model" }, cwd: "/tmp" },
	);

	assert.equal(seenTools.includes("write"), false, "write should be filtered");
	assert.equal(seenTools.includes("edit"), false, "edit should be filtered");
	assert.equal(seenTools.includes("read"), true, "read should be inherited");
	assert.equal(seenTools.includes("bash"), true, "bash should be inherited");
});

test("spawn adds a readonly bash override that mirrors parent readonly bash policy", async () => {
	const pi = new MockPi();
	pi.setActiveTools(["read", "bash", "spawn"]);
	const state = createState();
	state.readonlyEnabled = true;

	let seenTools: string[] = [];
	let seenCustomTools: any[] = [];
	const mockFactory = async (config: any) => {
		seenTools = config.tools;
		seenCustomTools = config.customTools;
		const session = {
			messages: [] as any[],
			prompt: async () => {
				session.messages = [{ role: "assistant", content: [{ type: "text", text: "done" }] }];
			},
			abort: async () => {},
			getSessionStats: () => undefined,
		};
		return { session: session as any };
	};

	registerSpawnTool(pi as any, state, mockFactory as any);
	await pi.tools.get("spawn").execute(
		"spawn-1",
		{ prompt: "Do the task" },
		undefined,
		undefined,
		{ model: { id: "mock-model" }, cwd: "/tmp" },
	);

	assert.equal(seenTools.includes("bash"), true, "bash should still be available");
	const bashTool = seenCustomTools.find((tool) => tool.name === "bash");
	assert.ok(bashTool, "readonly child should override bash");
	if (canUseOsSandbox()) {
		// OS-level sandbox is available, but classifyBashCommand pre-blocks
		// known dangerous commands at the spawnHook before the sandbox wraps.
		await assert.rejects(
			bashTool.execute("bash-1", { command: "sudo rm -rf /" }, undefined, undefined, {}),
			/Readonly mode: command blocked/,
		);
	} else {
		// Fallback: classifyBashCommand blocks at the spawnHook
		await assert.rejects(
			bashTool.execute("bash-1", { command: "sudo rm -rf /" }, undefined, undefined, {}),
			/Readonly mode: command blocked/,
		);
	}

	// Also verify that a safe command is ALLOWED through the child bash tool
	await assert.doesNotReject(
		bashTool.execute("bash-2", { command: "ls -la" }, undefined, undefined, {}),
		/Readonly mode: command blocked/,
	);
	await assert.doesNotReject(
		bashTool.execute("bash-3", { command: "   " }, undefined, undefined, {}),
		/Readonly mode: command blocked/,
	);
});

test("spawn non-readonly child can use inherited builtin write/edit", async () => {
	const pi = new MockPi();
	pi.setActiveTools(["read", "bash", "write", "edit", "spawn"]);
	const state = createState();
	state.readonlyEnabled = false;

	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-spawn-write-edit-"));
	const childFile = path.join(tmpDir, "child.txt");

	const mockFactory = async (config: any) => {
		const session = {
			messages: [] as any[],
			prompt: async () => {
				assert.equal(config.tools.includes("write"), true, "child should inherit builtin write");
				assert.equal(config.tools.includes("edit"), true, "child should inherit builtin edit");
				assert.equal(config.customTools.some((t: any) => t.name === "write"), false, "write should stay builtin");
				assert.equal(config.customTools.some((t: any) => t.name === "edit"), false, "edit should stay builtin");

				const childWrite = createWriteTool(config.cwd);
				const childEdit = createEditTool(config.cwd);
				await childWrite.execute("child-write", { path: childFile, content: "alpha\nbeta\n" }, undefined, undefined, {});
				await childEdit.execute(
					"child-edit",
					{ path: childFile, edits: [{ oldText: "beta", newText: "gamma" }] },
					undefined,
					undefined,
					{},
				);
				session.messages = [{ role: "assistant", content: [{ type: "text", text: fs.readFileSync(childFile, "utf8") }] }];
			},
			abort: async () => {},
			getSessionStats: () => undefined,
		};
		return { session: session as any };
	};

	registerSpawnTool(pi as any, state, mockFactory as any);
	try {
		const result = await pi.tools.get("spawn").execute(
			"spawn-1",
			{ prompt: "Write then edit the file" },
			undefined,
			undefined,
			{ model: { id: "mock-model" }, cwd: tmpDir },
		);

		assert.equal(fs.readFileSync(childFile, "utf8"), "alpha\ngamma\n");
		assert.equal(result.content[0].text, "alpha\ngamma");
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
});

test("spawn prompt includes readonly notice when enabled", async () => {
	const pi = new MockPi();
	pi.setActiveTools(["read", "bash", "spawn"]);
	const state = createState();
	state.readonlyEnabled = true;

	let seenPrompt = "";
	const mockFactory = async () => {
		const session = {
			messages: [] as any[],
			prompt: async (prompt: string) => {
				seenPrompt = prompt;
				session.messages = [{ role: "assistant", content: [{ type: "text", text: "done" }] }];
			},
			abort: async () => {},
			getSessionStats: () => undefined,
		};
		return { session: session as any };
	};

	registerSpawnTool(pi as any, state, mockFactory as any);
	await pi.tools.get("spawn").execute(
		"spawn-1",
		{ prompt: "Do the task" },
		undefined,
		undefined,
		{ model: { id: "mock-model" }, cwd: "/tmp" },
	);

	assert.match(seenPrompt, /readonly authority/);
	assert.match(seenPrompt, /Readonly restrictions apply/);
	assert.doesNotMatch(seenPrompt, /same authority as the parent/);
});

test("spawn prompt uses standard authority wording when readonly is off", async () => {
	const pi = new MockPi();
	pi.setActiveTools(["read", "bash", "spawn"]);
	const state = createState();
	state.readonlyEnabled = false;

	let seenPrompt = "";
	const mockFactory = async () => {
		const session = {
			messages: [] as any[],
			prompt: async (prompt: string) => {
				seenPrompt = prompt;
				session.messages = [{ role: "assistant", content: [{ type: "text", text: "done" }] }];
			},
			abort: async () => {},
			getSessionStats: () => undefined,
		};
		return { session: session as any };
	};

	registerSpawnTool(pi as any, state, mockFactory as any);
	await pi.tools.get("spawn").execute(
		"spawn-1",
		{ prompt: "Do the task" },
		undefined,
		undefined,
		{ model: { id: "mock-model" }, cwd: "/tmp" },
	);

	assert.match(seenPrompt, /same authority as the parent/);
	assert.doesNotMatch(seenPrompt, /read-only authority/);
	assert.doesNotMatch(seenPrompt, /Readonly restrictions apply/);
});
