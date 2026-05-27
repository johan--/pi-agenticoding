/**
 * Bash safety classifier for readonly mode.
 *
 * Blacklist approach: block destructive commands, allow everything else
 * (debugging, browser automation, system inspection, etc.).
 *
 * Git uses a strict allowlist — only known-immutable subcommands pass.
 */

// ── Destructive command blacklist ─────────────────────────────────────

const DESTRUCTIVE_PATTERNS: RegExp[] = [
	// File mutation
	/\b(rm|rmdir|mv|cp|mkdir|touch|chmod|chown|chgrp|ln|tee|truncate|dd|shred)\b/,
	// Privilege / process mutation
	/\b(sudo|su|kill|pkill|killall|reboot|shutdown)\b/,
	// Shell redirects
	/(^|[^<])>(?!>)/,
	/>>/,
	// Package mutation
	/\b(npm|yarn|pnpm)\s+(install|uninstall|update|ci|link|publish|add|remove)\b/i,
	/\bpip\s+(install|uninstall)\b/i,
	/\bapt(-get)?\s+(install|remove|purge|update|upgrade)\b/i,
	/\bbrew\s+(install|uninstall|upgrade)\b/i,
	/\b(cargo|gem)\s+(install|uninstall|update|build|publish)\b/i,
	/\b(yum|dnf)\s+(install|remove|update|upgrade|groupinstall)\b/i,
	/\bpacman\s+(-[SRU]|--sync|--remove|--upgrade)\b/i,
	/\bchoco\s+(install|uninstall|update|upgrade)\b/i,
	// Service mutation
	/\bsystemctl\s+(start|stop|restart|enable|disable)\b/i,
	/\bservice\s+\S+\s+(start|stop|restart)\b/i,
	// Editors (interactive or IDE-launching)
	/\b(vim?|nano|emacs|code|subl)\b/i,
];

/**
 * Git subcommand policy — three-tier classification.
 *
 * GIT_IMMUTABLE: Always pass. Commands that never modify repo state.
 *   diff, log, show, status, blame, grep, ls-files, ls-tree, merge-tree,
 *   format-patch, rev-parse, rev-list, cat-file, for-each-ref, merge-base,
 *   fsck, range-diff, shortlog, name-rev, describe, var, version
 *
 * GIT_MUTABLE: Always block. Commands that modify repo state.
 *   add, commit, push, pull, merge, rebase, reset, revert, cherry-pick,
 *   clean, rm, mv, restore, switch, checkout, fetch, init, clone
 *
 * GIT_MIXED: Allow only read-oriented flags/subcommands. Each entry has a
 *   predicate function. Strategy: ALLOWLIST — only known-safe subcommands pass,
 *   everything else blocks (conservative).
 *   reflog:     bare only (sub === "")
 *   branch:     --list, -l, bare, or any non-flag arg (e.g. a branch name)
 *   tag:        --list, -l, bare, or any non-flag arg
 *   stash:      list, show
 *   remote:     -v, show, get-url, bare
 *   config:     --get, --list, -l, bare
 *   notes:      list, show, bare
 *   worktree:   list, bare
 *   submodule:  status, bare
 *   apply:      always blocked (mutable by default)
 *   bisect:     log, view, bare
 */
// ── Git command policy ────────────────────────────────────────────────

/** Always-immutable git subcommands — always pass. */
const GIT_IMMUTABLE = new Set([
	"diff", "log", "show", "status", "blame", "grep",
	"ls-files", "ls-tree", "merge-tree", "format-patch",
	"rev-parse", "rev-list", "cat-file", "for-each-ref",
	"merge-base", "fsck", "range-diff", "shortlog", "name-rev",
	"describe", "var", "version",
]);

/** Always-mutable git subcommands — always block. */
const GIT_MUTABLE = new Set([
	"add", "commit", "push", "pull", "merge", "rebase", "reset",
	"revert", "cherry-pick", "clean", "rm", "mv", "restore",
	"switch", "checkout", "fetch", "init", "clone",
]);

/** Mixed subcommands: allow only read-oriented flags/subcommands. */
const GIT_MIXED: Record<string, (sub: string) => boolean> = {
	reflog: (sub) => sub === "",
	branch: (sub) => /^--?[a-zA-Z]*list/.test(sub) || sub === "-l" || sub === "" || !sub.startsWith("-"),
	tag: (sub) => /^--?[a-zA-Z]*list/.test(sub) || sub === "-l" || sub === "" || !sub.startsWith("-"),
	stash: (sub) => sub === "list" || sub === "show",
	remote: (sub) => sub === "-v" || sub === "show" || sub === "get-url" || sub === "",
	config: (sub) => sub === "--get" || sub.startsWith("--get=") || sub === "--list" || sub === "-l" || sub === "",
	notes: (sub) => sub === "list" || sub === "show" || sub === "",
	worktree: (sub) => sub === "list" || sub === "",
	submodule: (sub) => sub === "status" || sub === "",
	apply: () => false,
	bisect: (sub) => sub === "log" || sub === "view" || sub === "",
};

/**
 * Classify a git command as safe or unsafe for readonly mode.
 * Extracts the first subcommand and delegates to the policy tables.
 */
function isSafeGitCommand(cmd: string): boolean {
	// Extract everything after "git"
	const rest = cmd.replace(/^\s*git\s+/, "").trim();
	if (!rest) return false; // bare "git" — probably fine but conservative

	// Handle flags before subcommand: git --no-pager diff, git -C /path status
	// -C <path> and -c <name=value> consume the next token as their value.
	const tokens = rest.split(/\s+/);
	const FLAGS_WITH_VALUE = new Set(["-C", "-c"]);
	let subcommand = "";

	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (FLAGS_WITH_VALUE.has(token)) {
			i++; // skip the value argument
			continue;
		}
		if (token.startsWith("-")) continue; // skip flags without values
		subcommand = token;
		break;
	}

	if (!subcommand) return false;

	if (GIT_IMMUTABLE.has(subcommand)) return true;
	if (GIT_MUTABLE.has(subcommand)) return false;

	const mixedPolicy = GIT_MIXED[subcommand];
	if (mixedPolicy) {
		// Collect the part after the subcommand (lowercase, trimmed)
		const afterSub = rest.slice(rest.indexOf(subcommand) + subcommand.length).trim();
		return mixedPolicy(afterSub);
	}

	// Unknown git subcommand — conservative: block
	return false;
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Returns true if the bash command is safe to execute in readonly mode.
 *
 * Policy: blacklist destructive commands, allow everything else.
 * Git is the exception — strict allowlist.
 */
export function isSafeReadonlyCommand(cmd: string): boolean {
	// Git special policy
	if (/^\s*git\b/i.test(cmd)) {
		return isSafeGitCommand(cmd);
	}

	// Blacklist: if any destructive pattern matches, block
	for (const pattern of DESTRUCTIVE_PATTERNS) {
		if (pattern.test(cmd)) return false;
	}

	return true;
}
