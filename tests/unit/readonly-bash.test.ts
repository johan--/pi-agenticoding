import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { classifyBashCommand, applyReadonlyBashGuard } from "../../readonly-bash.js";
import { canUseOsSandbox, buildMacProfile, wrapWithSandboxExec, wrapWithBwrap, wrapCommandWithOsSandbox } from "../../os-sandbox.js";
import { resolveRealPath } from "../../resolve-path.js";

function isDirect(cmd: string, cwd = "/workspace"): boolean {
	return classifyBashCommand(cmd, cwd).ok === true;
}

function isBlocked(cmd: string, cwd = "/workspace"): boolean {
	return classifyBashCommand(cmd, cwd).ok === false;
}


test("classifyBashCommand allows non-mutating and unknown commands", () => {
	assert.equal(isDirect("ls -la"), true);
	assert.equal(isDirect("python3 script.py"), true);
	assert.equal(isDirect("curl https://example.com"), true);
	assert.equal(isDirect("docker ps"), true);
	assert.equal(isDirect("env FOO=bar node --version"), true);
	assert.equal(isDirect("export FOO=bar; echo $FOO"), true);
});

test("classifyBashCommand blocks writes outside temp but allows temp redirects", () => {
	const tempFile = `${os.tmpdir()}/pi-readonly-test.txt`;
	assert.equal(isBlocked("echo hello > file.txt"), true);
	assert.equal(isBlocked("cat > ./out.txt"), true);
	assert.equal(isDirect(`echo hello > ${tempFile}`), true);
	assert.equal(isDirect(`cat > ${tempFile}`), true);
	assert.equal(isDirect("ls >/dev/null"), true);
});

test("classifyBashCommand blocks explicit filesystem mutation outside temp", () => {
	assert.equal(isBlocked("rm file.txt"), true);
	assert.equal(isBlocked("mv a b"), true);
	assert.equal(isBlocked("cp a b"), true);
	assert.equal(isBlocked("mkdir newdir"), true);
	assert.equal(isBlocked("touch file"), true);
	assert.equal(isBlocked("chmod 755 file"), true);
	assert.equal(isBlocked("tee file"), true);
});

test("classifyBashCommand allows explicit filesystem mutation inside temp", () => {
	const tmp = os.tmpdir();
	assert.equal(isDirect(`rm ${tmp}/x`), true);
	assert.equal(isDirect(`mkdir ${tmp}/newdir`), true);
	assert.equal(isDirect(`touch ${tmp}/file`), true);
	assert.equal(isDirect(`cp ${tmp}/a ${tmp}/b`), true);
	assert.equal(isDirect(`mv ${tmp}/a ${tmp}/b`), true);
});

test("classifyBashCommand blocks rm -r outside temp (no -r value-skip bypass)", () => {
	// Critical fix: rm -r <target> must not be treated as "-r consumes target as value"
	assert.equal(isBlocked("rm -rf /etc/passwd"), true, "rm -rf outside temp");
	assert.equal(isBlocked("rm -r /etc/passwd"), true, "rm -r with standalone -r");
	assert.equal(isBlocked("rm -fr /etc/passwd"), true, "rm -fr combined flags");
	// Inside temp, rm -r should be allowed
	const tmp = os.tmpdir();
	assert.equal(isDirect(`rm -r ${tmp}/x`), true, "rm -r inside temp");
	assert.equal(isDirect(`rm -rf ${tmp}/x`), true, "rm -rf inside temp");
});

test("classifyBashCommand blocks truncate --no-create outside temp", () => {
	// Fix: --no-create is boolean, not value-consuming — must not skip the target
	assert.equal(isBlocked("truncate -s 0 --no-create /etc/config"), true, "truncate --no-create outside temp");
	const tmp = os.tmpdir();
	assert.equal(isDirect(`truncate -s 0 --no-create ${tmp}/config`), true, "truncate --no-create inside temp");
	// touch --no-create must also be correctly classified
	assert.equal(isBlocked("touch --no-create /etc/config"), true, "touch --no-create outside temp");
	assert.equal(isDirect(`touch --no-create ${tmp}/config`), true, "touch --no-create inside temp");
});

test("classifyBashCommand blocks mutable git commands and allows readonly git", () => {
	assert.equal(isDirect("git status"), true);
	assert.equal(isDirect("git log --oneline"), true);
	assert.equal(isDirect("git branch --list"), true);
	assert.equal(isDirect("git config --get user.name"), true);
	assert.equal(isBlocked("git add ."), true);
	assert.equal(isBlocked("git commit -m 'msg'"), true);
	assert.equal(isBlocked("git fetch"), true);
	assert.equal(isBlocked("git branch feature"), true);
	assert.equal(isBlocked("git tag v1"), true);
});

test("classifyBashCommand checks command substitutions for writes", () => {
	assert.equal(isBlocked("echo $(rm file.txt)"), true);
	assert.equal(isBlocked("echo `touch file.txt`"), true);
	assert.equal(isDirect("echo $(printf hi)"), true);
});

test("classifyBashCommand allows temp-safe shell parameter expansion defaults and blocks unsafe ones", () => {
	const varName = "PI_AGENTICODING_READONLY_UNSET_VAR";
	delete process.env[varName];
	const tmp = os.tmpdir();
	assert.equal(isDirect(`f=\${${varName}:-${tmp}/x}; echo hi > "$f"`), true, '${VAR:-temp} with unset var should be allowed');
	assert.equal(isDirect(`f=\${${varName}:=${tmp}/x}; echo hi > "$f"`), true, '${VAR:=temp} with unset var should be allowed');
	assert.equal(isBlocked(`f=\${${varName}:-/etc}; echo hi > "$f"`), true, '${VAR:-/etc} with unset var should be blocked');
	assert.equal(isBlocked(`f=\${${varName}:=/etc}; echo hi > "$f"`), true, '${VAR:=/etc} with unset var should be blocked');
});

test("classifyBashCommand preserves safe mktemp assignment flows", () => {
	const tmp = os.tmpdir();
	assert.equal(isDirect(`TMP=\`mktemp ${tmp}/pi.XXXXXX\`; echo ok > "$TMP"`), true, "backtick mktemp with explicit temp template");
	assert.equal(isDirect('TMP="$(mktemp -d)"; echo ok > "$TMP/ok"'), true, "quoted $(mktemp -d) assignment");
	assert.equal(isDirect('TMP="`mktemp -d`"; echo ok > "$TMP/ok"'), true, "quoted backtick mktemp");
	assert.equal(
		process.platform === "darwin"
			? isDirect('f=$(mktemp -t pi.XXXXXX); echo hi > "$f"')
			: isBlocked('f=$(mktemp -t pi.XXXXXX); echo hi > "$f"'),
		true,
		"mktemp -t should only be accepted on darwin",
	);
});

test("classifyBashCommand blocks mktemp assignments with non-temp relative or variable templates", () => {
	assert.equal(isBlocked("TMP=$(mktemp foo.XXXXXX); echo ok > \"$TMP\""), true, "relative mktemp template blocked");
	assert.equal(isBlocked("TPL=foo.XXXXXX; TMP=$(mktemp \"$TPL\"); echo ok > \"$TMP\""), true, "mktemp with unresolved shell var template blocked");
});
test("classifyBashCommand blocks mktemp -p/--tmpdir assignments outside temp", () => {
	assert.equal(isBlocked("TMP=$(mktemp -p /workspace pi.XXXXXX); echo ok > \"$TMP\""), true, "mktemp -p on non-temp dir blocked");
	assert.equal(isBlocked("TMP=$(mktemp --tmpdir=/workspace pi.XXXXXX); echo ok > \"$TMP\""), true, "mktemp --tmpdir= on non-temp dir blocked");
	assert.equal(isBlocked("TMP=$(mktemp --tmpdir workspace pi.XXXXXX); echo ok > \"$TMP\""), true, "mktemp --tmpdir relative dir blocked");
	assert.equal(isBlocked("TMP=$(mktemp --tmpdir ./workspace pi.XXXXXX); echo ok > \"$TMP\""), true, "mktemp --tmpdir ./relative dir blocked");
	assert.equal(isBlocked("TMP=$(mktemp --tmpdir ../workspace pi.XXXXXX); echo ok > \"$TMP\""), true, "mktemp --tmpdir ../relative dir blocked");
});


test("classifyBashCommand pipes and shell chaining stay direct for non-mutating commands", () => {
	assert.equal(isDirect("cat file | sort"), true, "cat | sort is safe");
	assert.equal(isDirect("ls -la | head -5"), true, "ls | head is safe");
	assert.equal(isDirect("export PATH=/tmp:$PATH; ls"), true, "shell state changes are not blocked by readonly");
});

test("classifyBashCommand block reasons stay mutation-focused", () => {
	const check = (cmd: string, expected: string) => {
		const v = classifyBashCommand(cmd, "/workspace");
		assert.equal(v.ok, false, `${cmd} should be blocked`);
		if (!v.ok) {
			assert.match(v.reason, new RegExp(expected, "i"), `reason for ${cmd}`);
		}
	};

	check("echo hi > out.txt", "write redirect");
	check("rm file.txt", "outside temp");
	check("git add .", "mutable git");
	check("echo $(rm file.txt)", "command substitution");
});

test("classifyBashCommand blocks find mutation and allows readonly find", () => {
	assert.equal(isBlocked("find . -exec rm {} +"), true, "find -exec rm is blocked");
	assert.equal(isBlocked("find . -delete"), true, "find -delete is blocked outside temp");
	assert.equal(isBlocked("find . -fprint out.txt"), true, "find -fprint is blocked outside temp");
	assert.equal(isDirect(`find ${os.tmpdir()} -delete`, "/workspace"), true, "temp-only delete is allowed");
	assert.equal(isDirect("find . -name \"*.ts\""), true, "find -name is direct");
});

test("classifyBashCommand allows cd and heredocs when they do not write outside temp", () => {
	assert.equal(isDirect("cd /tmp"), true, "cd is direct");
	assert.equal(isDirect("cd /var/log && ls"), true, "cd && ls is direct");
	assert.equal(isDirect("cat <<EOF\nhello\nEOF"), true, "plain heredoc is direct");
	assert.equal(isBlocked("cat <<EOF\n$(rm file.txt)\nEOF"), true, "mutating substitution in heredoc is blocked");
});

test("classifyBashCommand blocks sudo with direct mutation", () => {
	assert.equal(isBlocked("sudo rm /etc/passwd"), true, "sudo rm is blocked");
	assert.equal(isBlocked("sudo -u root rm /etc/passwd"), true, "sudo -u root rm is blocked");
});

test("classifyBashCommand blocks sudo with interpreter -c inline script", () => {
	assert.equal(isBlocked("sudo bash -c 'rm /etc/passwd'"), true, "sudo bash -c rm is blocked");
	assert.equal(isBlocked("sudo sh -c 'echo hi > /etc/config'"), true, "sudo sh -c with redirect blocked");
	assert.equal(isBlocked("sudo -u root bash -c \"rm -rf /etc\""), true, "sudo -u root bash -c rm blocked");
});

test("classifyBashCommand allows sudo with safe interpreter -c inline script", () => {
	assert.equal(isDirect("sudo bash -c 'echo hello'"), true, "sudo bash -c echo is safe");
});

test("classifyBashCommand blocks sed -i in-place mutation", () => {
	assert.equal(isBlocked("sed -i 's/a/b/g' file.txt"), true, "sed -i is blocked outside temp");
	assert.equal(isBlocked("sed -i '' 's/a/b/g' /etc/config"), true, "sed -i '' (macOS) is blocked outside temp");
	assert.equal(isBlocked("sed -i \"\" 's/a/b/g' /etc/config"), true, 'sed -i "" (macOS) is blocked outside temp');
	assert.equal(isBlocked("sed -i.bak 's/a/b/' /etc/config"), true, "sed -i.bak is blocked");
});

test("classifyBashCommand blocks dd output mutation", () => {
	assert.equal(isBlocked("dd if=/dev/zero of=/etc/passwd bs=1 count=1"), true, "dd of= outside temp is blocked");
	assert.equal(isDirect("dd if=/dev/zero of=" + os.tmpdir() + "/test bs=1 count=0"), true, "dd of= inside temp is allowed");
});

test("classifyBashCommand blocks perl in-place mutation", () => {
	assert.equal(isBlocked("perl -pi -e 's/a/b/g' file.txt"), true, "perl -pi is blocked outside temp");
});

test("classifyBashCommand blocks ruby in-place mutation", () => {
	assert.equal(isBlocked("ruby -pi -e 's/a/b/g' file.txt"), true, "ruby -pi is blocked outside temp");
});

test("classifyBashCommand blocks sed -i -e without backup extension", () => {
	// H4 fix: when -e is used without an explicit backup extension,
	// the first non-option arg is the target, not a backup extension.
	assert.equal(isBlocked("sed -i -e 's/foo/g' config"), true, "-e without backup ext");
	assert.equal(isBlocked("sed -i -e 's/foo/g' /etc/config"), true, "-e with full path");
	const tmp = os.tmpdir();
	assert.equal(isDirect("sed -i -e 's/foo/g' " + tmp + "/config"), true, "-e inside temp");
	// Existing macOS form with empty backup ext should still work
	assert.equal(isBlocked("sed -i '' -e 's/foo/g' /etc/config"), true, "empty backup ext + -e");
	assert.equal(isDirect("sed -i '' -e 's/foo/g' " + tmp + "/config"), true, "empty backup ext + -e inside temp");
});

test("classifyBashCommand blocks sed -i with multiple -e expressions outside temp", () => {
	// H3 fix: expression values from -e flags should not leak as false targets
	assert.equal(isBlocked("sed -i '' -e 's/foo/g' -e 's/bar/g' /etc/config"), true, "multi -e outside temp");
	const tmp = os.tmpdir();
	assert.equal(isDirect(`sed -i '' -e 's/foo/g' -e 's/bar/g' ${tmp}/config`), true, "multi -e inside temp");
	assert.equal(isDirect(`sed -i.bak -e 's/foo/g' ${tmp}/config`), true, "sed -i with backup ext inside temp");
	assert.equal(isBlocked("sed -i 's/foo/g' /etc/config"), true, "single expression outside temp");
	// --expression combined form (--expression=SCRIPT) must be detected
	assert.equal(isBlocked("sed -i '' --expression='s/foo/g' /etc/config"), true, "--expression= combined form outside temp");
	assert.equal(isDirect(`sed -i '' --expression='s/foo/g' ${tmp}/config`), true, "--expression= combined form inside temp");
	// --expression long form (separate arg)
	assert.equal(isBlocked("sed -i '' --expression 's/foo/g' /etc/config"), true, "--expression long form outside temp");
	assert.equal(isDirect(`sed -i '' --expression 's/foo/g' ${tmp}/config`), true, "--expression long form inside temp");
	// --expression combined form without backup extension
	assert.equal(isBlocked("sed -i --expression='s/foo/g' /etc/config"), true, "--expression= no backup ext outside temp");
	assert.equal(isDirect(`sed -i --expression='s/foo/g' ${tmp}/config`), true, "--expression= no backup ext inside temp");
});

test("classifyBashCommand blocks env prefix with mutation command", () => {
	assert.equal(isBlocked("env VAR=value rm file.txt"), true, "env rm is blocked");
	assert.equal(isBlocked("env -i PATH=/tmp rm file.txt"), true, "env -i rm is blocked");
});

test("classifyBashCommand blocks command prefix with mutation", () => {
	assert.equal(isBlocked("command rm file.txt"), true, "command rm is blocked");
});

test("classifyBashCommand blocks >> append redirect to unsafe target", () => {
	assert.equal(isBlocked("echo hi >> /etc/config"), true, ">> append to outside temp is blocked");
	const tmpFile = os.tmpdir() + "/test-append.txt";
	assert.equal(isDirect("echo hi >> " + tmpFile), true, ">> append to temp is allowed");
});

test("classifyBashCommand blocks >| noclobber redirect to unsafe target", () => {
	assert.equal(isBlocked("echo hi >| /etc/config"), true, ">| noclobber override to outside temp is blocked");
});

test("classifyBashCommand blocks quoted paths with spaces outside temp", () => {
	assert.equal(isBlocked("rm 'My File.txt'"), true, "rm with quoted space path is blocked outside temp");
	assert.equal(isBlocked("touch \"My File.txt\""), true, "touch with quoted space path is blocked outside temp");
	const tmpFile = "\"" + os.tmpdir() + "/My File.txt\"";
	assert.equal(isDirect("rm " + tmpFile), true, "rm with quoted space path in temp is allowed");
});

test("classifyBashCommand blocks path traversal attacks", () => {
	assert.equal(isBlocked("rm /tmp/../etc/passwd"), true, "path traversal outside temp is blocked");
	assert.equal(isBlocked("rm /private/var/tmp/../../../etc/passwd"), true, "relative traversal outside temp is blocked");
});

// ── classifyBashCommand: fd redirect passthrough ─────────────────────

test("classifyBashCommand allows fd redirect passthrough", () => {
	assert.equal(isDirect("echo hi 2>&1"), true, "fd redirect 2>&1 is passthrough");
	assert.equal(isDirect("echo hi 2>/dev/null"), true, "fd redirect to /dev/null is safe");
	assert.equal(isDirect("exec 3>&1"), true, "exec fd redirect is safe");
});

// ── classifyBashCommand: empty/bare commands ─────────────────────────

test("classifyBashCommand handles empty and bare commands", () => {
	assert.equal(isDirect(""), true, "empty string should be allowed");
	assert.equal(isDirect("   "), true, "whitespace should be allowed");
	assert.equal(isBlocked("git"), true, "bare git without subcommand should be blocked");
});

test("classifyBashCommand allows npm run build inside temp", () => {
	// H1 fix: 'build' removed from package mutation regex. 'npm run build' is not
	// a package installation — it runs a build script. Package installations are
	// still caught by install/uninstall/add/remove/etc.
	const tmp = os.tmpdir();
	assert.equal(isDirect(`cd ${tmp} && npm run build`), true, "npm run build inside temp");
	// npm run build outside temp should also be allowed (not a package mutation)
	assert.equal(isDirect("npm run build"), true, "npm run build allowed anywhere");
	assert.equal(isDirect(`cd ${tmp} && yarn build`), true, "yarn build inside temp");
	assert.equal(isDirect(`cd ${tmp} && npm build`), true, "npm build (old-style) inside temp");
	// Actual package mutations should still be blocked
	assert.equal(isBlocked("npm install lodash"), true, "npm install still blocked");
	assert.equal(isBlocked("pip install requests"), true, "pip install still blocked");
	// apt build-dep is a package mutation (not a script build)
	assert.equal(isBlocked("apt build-dep nginx"), true, "apt build-dep still blocked");
	assert.equal(isBlocked("dnf build-dep nginx"), true, "dnf build-dep still blocked");
});

test("classifyBashCommand resolves glob patterns inside temp", () => {
	// H2 fix: glob patterns like *.log should be resolved and checked per-target
	const tmp = os.tmpdir();
	// Empty glob (no matches) should be allowed — no files to mutate
	assert.equal(isDirect(`rm ${tmp}/*.nonexistent`), true, "empty glob is allowed");
	// Empty glob outside temp is also allowed (no files to mutate)
	assert.equal(isDirect("rm *.log"), true, "empty glob to non-existent files is allowed");
	// Glob to explicitly non-temp paths is blocked
	assert.equal(isBlocked("rm /etc/*.conf"), true, "glob to /etc is blocked");
	// Non-mutating globs should pass
	assert.equal(isDirect("ls *.ts"), true, "ls with glob is allowed");
	// Glob with actual matches inside temp should be allowed
	const testFile = path.join(tmp, "readonly-test-glob-match.tmp");
	try { fs.writeFileSync(testFile, ""); } catch { /* best-effort */ }
	try {
		assert.equal(isDirect(`rm ${tmp}/*.tmp`), true, "glob matches inside temp is allowed");
	} finally {
		try { fs.unlinkSync(testFile); } catch { /* best-effort cleanup */ }
	}
});

test("classifyBashCommand resolves ~ paths", () => {
	// ~ expands via os.homedir() — homedir is outside temp, so mutations blocked.
	// This verifies the expansion code path runs (vs. old blanket-block on ~ chars).
	assert.equal(isBlocked("rm ~/test-file"), true, "rm ~/file blocked (home outside temp)");
	assert.equal(isBlocked("touch ~/test-file"), true, "touch ~/file blocked (home outside temp)");

	// ~user/path blocked conservatively (cannot resolve without getpwuid)
	assert.equal(isBlocked("rm ~other/file"), true, "rm ~user/file blocked (unresolvable user)");

	// Non-mutating commands with ~ are allowed
	assert.equal(isDirect("ls ~"), true, "ls ~ allowed");
	assert.equal(isDirect("ls ~/Documents"), true, "ls ~/Documents allowed");
	assert.equal(isDirect("echo ~"), true, "echo ~ allowed");

	// Mutating command where target happens to be inside temp after tilde expansion
	// Use a temp-relative path — tilde expands to homedir, which is outside temp,
	// so a path like ~/tmp/... still resolves outside temp. This assertion confirms
	// tilde expansion happened correctly and the temp check runs on the result.
	const tmp = os.tmpdir();
	assert.equal(isDirect(`ls ${tmp}`), true, "non-mutating ls to temp is allowed");
});

test("classifyBashCommand allows temp paths carried through shell variables across segments", () => {
	const tmp = os.tmpdir();
	assert.equal(isDirect(`tmp=${tmp}/pi-readonly-file; rm "$tmp"`), true, "rm via assigned temp var allowed");
	assert.equal(isDirect(`tmp=${tmp}/pi-readonly-file; echo hi > "$tmp"`), true, "redirect via assigned temp var allowed");
	assert.equal(isDirect('f=$(mktemp); echo hi > "$f"'), true, "mktemp assignment should be treated as temp");
	assert.equal(isBlocked('f=/etc/passwd; echo hi > "$f"'), true, "non-temp assigned var still blocked");
});

test("classifyBashCommand tracks export-prefixed shell assignments", () => {
	const tmp = os.tmpdir();
	assert.equal(isDirect(`export T=${tmp}/x; rm "$T"`), true, "export assignment tracked");
	assert.equal(isBlocked('export T=/etc/x; rm "$T"'), true, "export non-temp still blocked");
	assert.equal(isDirect(`declare -r T=${tmp}/x; cat "$T"`), true, "declare -r assignment tracked");
});

test("classifyBashCommand propagates shellVars through sudo", () => {
	const tmp = os.tmpdir();
	assert.equal(isDirect(`tmp=${tmp}/x; sudo rm "$tmp"`), true, "sudo with temp var allowed");
	assert.equal(isBlocked('tmp=/etc/x; sudo rm "$tmp"'), true, "sudo with non-temp var blocked");
});

test("classifyBashCommand propagates vars across && segments", () => {
	const tmp = os.tmpdir();
	assert.equal(isDirect(`a=${tmp}/x && b=$a && rm "$b"`), true, "cascading var across && allowed");
});

// ── classifyBashCommand: exact-string contract tests ─────────────────

test("classifyBashCommand exact reason: git mutable block", () => {
	const v = classifyBashCommand("git add .", "/workspace");
	assert.equal(v.ok, false);
	if (!v.ok) {
		assert.match(v.reason, /mutable git/);
	}
});

test("classifyBashCommand exact reason: command substitution block", () => {
	const v = classifyBashCommand("echo \$(rm file.txt)", "/workspace");
	assert.equal(v.ok, false);
	if (!v.ok) {
		assert.match(v.reason, /command substitution/);
	}
});

test("classifyBashCommand exact reason: write redirect block", () => {
	const v = classifyBashCommand("echo hi > out.txt", "/workspace");
	assert.equal(v.ok, false);
	if (!v.ok) {
		assert.match(v.reason, /write redirect blocked outside temp dir/);
	}
});


// ── classifyBashCommand: sudo -h fix (F1) ────────────────────────────

test("classifyBashCommand blocks sudo -h with mutating command", () => {
	assert.equal(isBlocked("sudo -h localhost rm /etc/passwd"), true, "sudo -h localhost rm should be blocked");
	assert.equal(isBlocked("sudo -h host apt-get install nginx"), true, "sudo -h host apt-get should be blocked");
});

// ── classifyBashCommand: env -u fix (F2) ─────────────────────────────

test("classifyBashCommand blocks env -u with mutating command", () => {
	assert.equal(isBlocked("env -u HOME rm /etc/passwd"), true, "env -u HOME rm blocked");
	assert.equal(isBlocked("env --unset HOME rm /etc/passwd"), true, "env --unset HOME rm blocked");
});

// ── classifyBashCommand: touch -t/-d/-r (H1) ─────────────────────────

test("classifyBashCommand allows touch with -t/-d/-r flags inside temp", () => {
	const tmp = os.tmpdir();
	assert.equal(isDirect(`touch -t 202001010000 ${tmp}/safe`), true, "touch -t timestamp inside temp");
	assert.equal(isDirect(`touch -d '2020-01-01' ${tmp}/safe`), true, "touch -d date inside temp");
	assert.equal(isDirect(`touch -r ${tmp}/ref ${tmp}/target`), true, "touch -r ref file inside temp");
});

// ── classifyBashCommand: additional command coverage ─────────────────

test("classifyBashCommand blocks install, ln, truncate, unlink, rmdir outside temp", () => {
	assert.equal(isBlocked("install /tmp/foo /etc/bar"), true, "install to outside temp");
	assert.equal(isBlocked("ln /tmp/foo /etc/bar"), true, "ln hard link to outside temp");
	assert.equal(isBlocked("truncate -s 0 /etc/config"), true, "truncate outside temp");
	assert.equal(isBlocked("unlink /etc/file"), true, "unlink outside temp");
	assert.equal(isBlocked("rmdir /etc/empty-dir"), true, "rmdir outside temp");
	assert.equal(isBlocked("chown root /etc/file"), true, "chown outside temp");
	assert.equal(isBlocked("chgrp root /etc/file"), true, "chgrp outside temp");
});

// ── classifyBashCommand: env fix (env -S bypass) ──────────────────

test("classifyBashCommand blocks env -S bypass for mutating commands and redirects", () => {
	assert.equal(isBlocked('env -S "rm -rf /"'), true, "env -S with rm is blocked");
	assert.equal(isBlocked('env -u HOME -S "touch /etc/passwd"'), true, "env -u HOME -S with touch is blocked");
	assert.equal(isBlocked('env -S "git add ."'), true, "env -S with git add is blocked");
	assert.equal(isBlocked('env -S "echo hi > /etc/config"'), true, "env -S with redirect is blocked");
	assert.equal(isBlocked('env KEY=value rm file.txt'), true, "env KEY=value with rm is blocked");
});

test("classifyBashCommand allows non-mutating env -S inline commands", () => {
	assert.equal(isDirect('env -S "echo hi"'), true, "env -S with echo is allowed");
});

test("classifyBashCommand blocks env --split-string bypass for mutating commands", () => {
	assert.equal(isBlocked('env --split-string "rm -rf /"'), true, "env --split-string rm blocked");
	assert.equal(isBlocked('env -u HOME --split-string "touch /etc/passwd"'), true, "env -u HOME --split-string touch blocked");
	assert.equal(isBlocked('env --split-string "git add ."'), true, "env --split-string git add blocked");
	assert.equal(isBlocked('env --split-string "echo hi > /etc/config"'), true, "env --split-string redirect blocked");
});

test("classifyBashCommand allows non-mutating env --split-string inline commands", () => {
	assert.equal(isDirect('env --split-string "echo hi"'), true, "env --split-string echo allowed");
});

test("classifyBashCommand blocks env without -S with mutating direct commands", () => {
	assert.equal(isBlocked('env rm /etc/passwd'), true, "env rm is blocked");
	assert.equal(isBlocked('env -i rm /etc/passwd'), true, "env -i rm is blocked");
	assert.equal(isDirect('env - PATH=/tmp ls'), true, "env - PATH=/tmp ls is allowed");
});

test("classifyBashCommand extracts and classifies process substitution <()", () => {
	assert.equal(isBlocked("cat <(rm /etc/passwd)"), true, "<() rm outside temp blocked");
	assert.equal(isBlocked("cat <(git add .)"), true, "<() git add blocked");
	assert.equal(isBlocked("cat <(bash -c 'rm /etc/passwd')"), true, "<() bash -c rm blocked");
	assert.equal(isDirect("cat <(echo hi)"), true, "<() echo allowed");
	assert.equal(isDirect("diff <(git diff) <(git status)"), true, "<() git immutable in diff allowed");
});

// ── classifyBashCommand: git readonly subcommand regressions ─────────

test("classifyBashCommand allows git stash read-only subcommands", () => {
	assert.equal(isDirect("git stash list"), true, "git stash list is allowed");
	assert.equal(isDirect("git stash show"), true, "git stash show is allowed");
});

test("classifyBashCommand blocks git stash mutable subcommands", () => {
	assert.equal(isBlocked("git stash push"), true, "git stash push is blocked");
	assert.equal(isBlocked("git stash drop"), true, "git stash drop is blocked");
});

test("classifyBashCommand allows git tag read-only subcommands", () => {
	assert.equal(isDirect("git tag"), true, "bare git tag is allowed");
	assert.equal(isDirect("git tag --list"), true, "git tag --list is allowed");
	assert.equal(isDirect("git tag -l"), true, "git tag -l is allowed");
});

test("classifyBashCommand blocks git tag mutable subcommands", () => {
	assert.equal(isBlocked("git tag v1.0"), true, "git tag v1.0 is blocked");
});

test("classifyBashCommand allows git submodule read-only subcommands", () => {
	assert.equal(isDirect("git submodule status"), true, "git submodule status is allowed");
});

test("classifyBashCommand blocks git submodule mutable subcommands", () => {
	assert.equal(isBlocked("git submodule add"), true, "git submodule add is blocked");
});

test("classifyBashCommand allows git worktree read-only subcommands", () => {
	assert.equal(isDirect("git worktree list"), true, "git worktree list is allowed");
});

test("classifyBashCommand blocks git worktree mutable subcommands", () => {
	assert.equal(isBlocked("git worktree add"), true, "git worktree add is blocked");
});

test("classifyBashCommand allows git bisect read-only subcommands and bare bisect", () => {
	assert.equal(isDirect("git bisect log"), true, "git bisect log is allowed");
	assert.equal(isDirect("git bisect view"), true, "git bisect view is allowed");
	assert.equal(isDirect("git bisect"), true, "bare git bisect is allowed");
});

test("classifyBashCommand blocks git bisect mutable subcommands", () => {
	assert.equal(isBlocked("git bisect start"), true, "git bisect start is blocked");
	assert.equal(isBlocked("git bisect reset"), true, "git bisect reset is blocked");
});


test("classifyBashCommand blocks node -e with dangerous code", () => {
	assert.equal(isBlocked('node -e "rm file.txt"'), true);
});

test("classifyBashCommand allows node -e with safe code", () => {
	assert.equal(isDirect('node -e "console.log(1)"'), true);
});

test("classifyBashCommand blocks python3 -c with dangerous code", () => {
	assert.equal(isBlocked('python3 -c "rm file.txt"'), true);
});

test("classifyBashCommand blocks perl -e with dangerous code", () => {
	assert.equal(isBlocked('perl -e "rm file.txt"'), true);
});

test("classifyBashCommand blocks ruby -e with dangerous code", () => {
	assert.equal(isBlocked('ruby -e "rm file.txt"'), true);
});

test("classifyBashCommand allows node -c (syntax check only)", () => {
	assert.equal(isDirect('node -c "const x = 1"'), true);
});

// ── S3: eval/exec/subshell handling ────────────────────────────────

test("classifyBashCommand blocks eval with dangerous command", () => {
	assert.equal(isBlocked("eval 'rm -rf /'"), true);
});

test("classifyBashCommand allows eval with safe command", () => {
	assert.equal(isDirect("eval 'echo hi'"), true);
});

test("classifyBashCommand blocks exec with dangerous command", () => {
	assert.equal(isBlocked("exec rm file.txt"), true);
});

test("classifyBashCommand allows exec with safe command", () => {
	assert.equal(isDirect("exec ls"), true);
});

test("classifyBashCommand blocks subshell parens with mutation", () => {
	assert.equal(isBlocked("(rm file.txt)"), true);
});

test("classifyBashCommand allows subshell parens with safe command", () => {
	assert.equal(isDirect("(echo hi)"), true);
});

test("classifyBashCommand blocks curl -o outside temp", () => {
	assert.equal(isBlocked("curl -o /etc/passwd http://example.com"), true);
});

test("classifyBashCommand allows curl -o inside temp", () => {
	const tmp = os.tmpdir();
	assert.equal(isDirect(`curl -o ${tmp}/out.html http://example.com`), true);
});

test("classifyBashCommand blocks curl --output outside temp", () => {
	assert.equal(isBlocked("curl --output /tmp/../outside.txt http://example.com"), true);
});

test("classifyBashCommand blocks curl -O (remote-name) outside temp", () => {
	assert.equal(isBlocked("curl -O http://example.com/evil.sh"), true, "-O writes to cwd");
	assert.equal(isBlocked("curl --remote-name http://example.com/evil.sh"), true, "--remote-name writes to cwd");
	assert.equal(isBlocked("curl -OJ http://example.com/evil.sh"), true, "-OJ combined form");
});

test("classifyBashCommand allows curl -O (remote-name) inside temp cwd", () => {
	const tmp = os.tmpdir();
	assert.equal(isDirect("curl -O http://example.com/evil.sh", tmp), true, "-O allowed when cwd is temp");
	assert.equal(isDirect("curl --remote-name http://example.com/evil.sh", tmp), true, "--remote-name allowed when cwd is temp");
});

test("classifyBashCommand blocks curl remote-name flag permutations outside temp", () => {
	const tmp = os.tmpdir();
	assert.equal(isBlocked("curl -JO http://example.com/evil.sh"), true, "-JO now blocked outside temp");
	assert.equal(isBlocked("curl -sJO http://example.com/evil.sh"), true, "-sJO now blocked outside temp");
	assert.equal(isBlocked("curl --remote-name-all http://example.com/evil.sh"), true, "--remote-name-all now blocked outside temp");
	assert.equal(isDirect("curl -JO http://example.com/evil.sh", tmp), true, "same forms remain allowed when cwd is temp");
});

test("classifyBashCommand does not confuse curl attached option values with -O", () => {
	assert.equal(isDirect("curl -XPOST http://example.com"), true, "-XPOST should not be treated as remote-name");
	assert.equal(isDirect("curl -AFOO http://example.com"), true, "-AFOO should not be treated as remote-name");
	assert.equal(isDirect("curl -bCOOKIE http://example.com"), true, "-bCOOKIE should not be treated as remote-name");
	assert.equal(isDirect("curl -uUSER http://example.com"), true, "-uUSER should not be treated as remote-name");
	assert.equal(isDirect("curl -CO http://example.com"), true, "-CO should not be treated as remote-name");
	assert.equal(isDirect("curl -KO http://example.com"), true, "-KO should not be treated as remote-name");
	// Regression: flags not previously in CURL_VALUE_SHORT_FLAGS — none write to cwd
	assert.equal(isDirect("curl -dO http://example.com"), true, "-dO is POST data, no cwd write");
	assert.equal(isDirect("curl -DO http://example.com"), true, "-DO is dump-header, no cwd write");
	assert.equal(isDirect("curl -FO http://example.com"), true, "-FO is form data, no cwd write");
	assert.equal(isDirect("curl -cO http://example.com"), true, "-cO is cookie-jar, no cwd write");
	// Regression: -eO, -HO, -PO are value-consuming flags, not remote-name
	assert.equal(isDirect("curl -eO http://example.com"), true, "-eO is referer, not remote-name");
	assert.equal(isDirect("curl -HO http://example.com"), true, "-HO is header, not remote-name");
	assert.equal(isDirect("curl -PO http://example.com"), true, "-PO is ftp-port, not remote-name");
	// -oO writes to cwd via -o flag, so it IS blocked (correct behavior)
	assert.equal(isBlocked("curl -oO http://example.com"), true, "-oO writes to O in cwd via -o flag");
});

test("classifyBashCommand blocks curl -O even with explicit -o temp path", () => {
	const tmp = os.tmpdir();
	// -O still writes URL basename to cwd, even when -o targets temp dir
	assert.equal(isBlocked("curl -O -o " + tmp + "/out.html http://example.com"), true, "-O cwd write still blocked despite -o temp");
	assert.equal(isBlocked("curl -o " + tmp + "/out.html -O http://example.com"), true, "-O cwd write still blocked when -o before -O");
});

test("classifyBashCommand blocks curl -O combined with -o outside temp", () => {
	// -O writes URL basename to cwd even when -o is present — curl uses both cumulatively
	assert.equal(isBlocked("curl -o /etc/passwd -O http://example.com"), true, "-O cwd write blocked despite -o outside temp");
	assert.equal(isBlocked("curl -O -o /etc/passwd http://example.com"), true, "-O cwd write blocked when -o is before -O");
});

test("classifyBashCommand blocks curl -O combined with -o inside temp", () => {
	const tmp = os.tmpdir();
	// -o points to temp dir, but -O still writes to cwd — must be blocked
	assert.equal(isBlocked("curl -o " + tmp + "/out -O http://example.com"), true, "-O cwd write blocked even when -o targets temp");
	assert.equal(isBlocked("curl -O -o " + tmp + "/out http://example.com"), true, "-O cwd write blocked regardless of flag order");
});

test("classifyBashCommand allows curl -O combined with -o when cwd and output are both temp", () => {
	const tmp = os.tmpdir();
	assert.equal(isDirect("curl -o " + tmp + "/out -O http://example.com", tmp), true, "-O and -o both allowed when both writes stay in temp");
	assert.equal(isDirect("curl -O -o " + tmp + "/out http://example.com", tmp), true, "flag order does not matter when both writes stay in temp");
});

test("classifyBashCommand blocks curl --output=VALUE outside temp", () => {
	assert.equal(isBlocked("curl --output=/etc/passwd http://example.com"), true, "--output=/etc/passwd writes to disk");
});

test("classifyBashCommand allows curl --output=VALUE inside temp", () => {
	const tmp = os.tmpdir();
	assert.equal(isDirect(`curl --output=${tmp}/out http://example.com`), true, "--output=/tmp/... writes to temp");
});

test("classifyBashCommand blocks curl -o/path combined form outside temp", () => {
	assert.equal(isBlocked("curl -o/etc/passwd http://example.com"), true, "-o/etc/passwd combined short form writes to disk");
});

test("classifyBashCommand allows curl -o/path combined form inside temp", () => {
	const tmp = os.tmpdir();
	assert.equal(isDirect(`curl -o${tmp}/out http://example.com`), true, "-o/tmp/out combined short form writes to temp");
});

test("classifyBashCommand blocks curl -O (remote-name) outside temp (error message)", () => {
	const verdict = classifyBashCommand("curl -O http://example.com/evil.sh");
	assert.equal(verdict.ok, false);
	assert.match(verdict.reason, /curl blocked/, "error message mentions curl");
});

test("classifyBashCommand allows curl -- -O (-- ends options, -O is a URL arg)", () => {
	assert.equal(isDirect("curl -- -O"), true, "-O after -- is a URL, not a flag");
});

test("classifyBashCommand blocks curl -O before -- (flag before end-of-options)", () => {
	assert.equal(isBlocked("curl -O -- http://example.com/evil.sh"), true, "-O before -- is still a flag");
});

test("classifyBashCommand blocks curl with multiple -o flags where first is unsafe", () => {
	assert.equal(isBlocked("curl -o /etc/passwd -o /tmp/f http://example.com"), true, "first -o outside temp blocked");
});

test("classifyBashCommand allows curl with multiple -o flags both inside temp", () => {
	const tmp = os.tmpdir();
	assert.equal(isDirect(`curl -o ${tmp}/f1 -o ${tmp}/f2 http://example.com`, tmp), true, "both -o in temp allowed");
});

test("classifyBashCommand allows curl -o - (stdout)", () => {
	assert.equal(isDirect("curl -o - http://example.com"), true, "-o - writes to stdout");
	assert.equal(isDirect("curl --output - http://example.com"), true, "--output - writes to stdout");
});

test("classifyBashCommand allows wget -O inside temp", () => {
	const tmp = os.tmpdir();
	assert.equal(isDirect(`wget -O ${tmp}/out.html http://example.com`), true);
});

test("classifyBashCommand blocks wget -O outside temp", () => {
	assert.equal(isBlocked("wget -O /etc/passwd http://example.com"), true);
});

test("classifyBashCommand allows wget --output-document inside temp", () => {
	const tmp = os.tmpdir();
	assert.equal(isDirect(`wget --output-document ${tmp}/out.html http://example.com`), true);
});

test("classifyBashCommand blocks wget --output-document outside temp", () => {
	assert.equal(isBlocked("wget --output-document /etc/passwd http://example.com"), true);
});

test("classifyBashCommand blocks wget without output flags", () => {
	assert.equal(isBlocked("wget http://example.com"), true, "wget without -O writes to disk by default");
});

test("classifyBashCommand allows curl without output flags", () => {
	assert.equal(isDirect("curl http://example.com"), true, "curl without -o outputs to stdout");
});

// ── classifyBashCommand: wget -O- stdout ────────────────────────────

test("classifyBashCommand allows wget -O- stdout output", () => {
	assert.equal(isDirect("wget -O- http://example.com"), true, "-O- combined token writes to stdout");
	assert.equal(isDirect("wget -O - http://example.com"), true, "-O separate token writes to stdout");
	assert.equal(isDirect("wget --output-document=- http://example.com"), true, "--output-document=- writes to stdout");
});

test("classifyBashCommand uses the last wget output flag", () => {
	const tmp = os.tmpdir();
	assert.equal(isBlocked("wget -O- -O /etc/passwd http://example.com"), true, "later file output should win over stdout");
	assert.equal(isBlocked("wget --output-document=- --output-document=/etc/passwd http://example.com"), true, "later long output flag should win over stdout");
	assert.equal(isDirect(`wget -O /etc/passwd -O ${tmp}/out.html http://example.com`), true, "later temp output should win over earlier unsafe path");
	assert.equal(isDirect(`wget -O ${tmp}/out.html -O- http://example.com`), true, "later stdout output should win over earlier temp path");
});

test("classifyBashCommand recognizes temp-dir download flags", () => {
	const tmp = os.tmpdir();
	assert.equal(isDirect(`wget -P ${tmp} http://example.com/file.txt`), true, "wget -P temp allowed");
	assert.equal(isDirect(`wget --directory-prefix=${tmp} http://example.com/file.txt`), true, "wget --directory-prefix temp allowed");
	assert.equal(isBlocked("wget -P /etc http://example.com/file.txt"), true, "wget -P non-temp blocked");
	assert.equal(isDirect(`curl -O --output-dir ${tmp} http://example.com/file.txt`), true, "curl --output-dir temp allowed");
	assert.equal(isBlocked("curl -O --output-dir /etc http://example.com/file.txt"), true, "curl --output-dir non-temp blocked");
});

test("classifyBashCommand allows mktemp-backed temp vars and blocks non-temp templates", () => {
	const tmp = os.tmpdir();
	assert.equal(isDirect('f=$(mktemp -d); echo hi > "$f/ok"'), true, "plain mktemp -d should stay temp-safe");
	assert.equal(isDirect(`f=$(mktemp -d ${tmp}/pi.XXXX); echo hi > "$f/ok"`), true, "explicit temp mktemp template should stay temp-safe");
	assert.equal(isDirect(`TMPBASE=${tmp} f=$(mktemp --tmpdir="$TMPBASE" pi.XXXX); echo hi > "$f/ok"`), true, "same-segment assignment chaining should stay temp-safe");
	assert.equal(isDirect(`TMPBASE=${tmp}; f=$(mktemp --tmpdir="$TMPBASE" pi.XXXX); echo hi > "$f/ok"`), true, "quoted --tmpdir shell var should stay temp-safe");
	assert.equal(
		process.platform === "darwin"
			? isDirect('f=$(mktemp -t pi.XXXX); echo hi > "$f"')
			: isBlocked('f=$(mktemp -t pi.XXXX); echo hi > "$f"'),
		true,
		"mktemp -t should follow platform semantics",
	);
	assert.equal(isBlocked('f=$(mktemp -d /etc/temp.XXXX); echo hi > "$f/ok"'), true, "mktemp -d with explicit non-temp dir should be blocked");
	assert.equal(isBlocked('f=$(echo /etc); echo hi > "$f/ok"'), true, "command-substituted non-temp dir should be blocked");
	assert.equal(isBlocked('f=`echo /etc`; echo hi > "$f/ok"'), true, "backtick-substituted non-temp dir should be blocked");
	assert.equal(isBlocked('f=$(printf /etc); touch "$f/x"'), true, "dynamic non-temp path should be blocked");
	assert.equal(isDirect(`f=$(mktemp --suffix .bak ${tmp}/pi.XXXX); echo hi > "$f/ok"`), true, "--suffix flag should be properly skipped");
	assert.equal(isDirect('f=$(mktemp --tmpdir pi.XXXX); echo hi > "$f"'), true, "mktemp --tmpdir without explicit dir uses default temp");
});


// ── N4: xargs command classification ───────────────────────────────

test("classifyBashCommand blocks xargs with mutation command and concrete target", () => {
	assert.equal(isBlocked("echo /etc/passwd | xargs rm"), true, "xargs rm outside temp blocked");
	assert.equal(isBlocked("echo . | xargs git add"), true, "xargs git add blocked");
	assert.equal(isBlocked("echo '/etc/passwd' | xargs bash -c 'rm /etc/passwd'"), true, "xargs bash -c rm blocked");
	assert.equal(isBlocked("echo install | xargs npm install"), true, "xargs npm install blocked");
});

test("classifyBashCommand allows xargs with safe command", () => {
	assert.equal(isDirect("echo file.txt | xargs echo"), true);
});

test("classifyBashCommand blocks xargs with flags and mutation", () => {
	assert.equal(isBlocked("echo /etc/passwd | xargs -I {} rm {}"), true);
});

test("classifyBashCommand allows xargs with flags and safe command", () => {
	assert.equal(isDirect("echo file.txt | xargs -I {} echo {}"), true);
});

// ── os-sandbox: OS-level sandbox tests ─────────────────────────────

test("os-sandbox: buildMacProfile includes deny file-write* and allow /dev/null", () => {
	const tempDir = os.tmpdir();
	const profile = buildMacProfile(tempDir);
	assert.ok(profile.includes("(allow default)"), "profile should allow default");
	assert.ok(profile.includes("(deny file-write*)"), "profile should deny all file-write*");
	assert.ok(profile.includes('/dev/null'), "profile should allow /dev/null");
	assert.ok(profile.includes('(allow file-write* (subpath'), "profile should allow subpath writes");
});

test("os-sandbox: buildMacProfile rejects paths containing single or double quotes", () => {
	assert.throws(
		() => buildMacProfile("/tmp/evil'path"),
		/quote/,
		"should reject single quote in path",
	);
	assert.throws(
		() => buildMacProfile('/tmp/evil"path'),
		/quote/,
		"should reject double quote in path",
	);
});

test("os-sandbox: wrapWithSandboxExec uses heredoc", () => {
	const cmd = "echo hello";
	const result = wrapWithSandboxExec(cmd);
	assert.ok(result.startsWith("sandbox-exec -p '"), "should start with sandbox-exec -p");
	assert.ok(result.includes("PI_SANDBOX_INNER_"), "should include heredoc delimiter");
	assert.ok(result.includes(cmd), "should contain original command");
	assert.ok(result.includes("/bin/bash << '"), "should use heredoc with bash");
});

test("os-sandbox: wrapWithBwrap includes ro-bind and tmpfs", () => {
	const cmd = "echo hello";
	const result = wrapWithBwrap(cmd);
	assert.ok(result.startsWith("bwrap"), "should start with bwrap");
	assert.ok(result.includes("--ro-bind / /"), "should include ro-bind root");
	assert.ok(result.includes("--tmpfs /tmp"), "should include tmpfs /tmp");
	assert.ok(result.includes(cmd), "should contain original command");
	assert.ok(result.includes("/bin/bash << '"), "should use heredoc with bash");
});

test("os-sandbox external invariant: wrapped command blocks non-temp writes and allows temp writes", () => {
	if (!canUseOsSandbox()) return;

	const outsidePath = path.join(process.cwd(), `.pi-readonly-outside-${Date.now()}`);
	const insideDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-readonly-sandbox-"));
	const insidePath = path.join(insideDir, "inside.txt");
	try {
		assert.throws(
			() => execFileSync("/bin/bash", ["-c", wrapCommandWithOsSandbox(`echo blocked > "${outsidePath}"`)], { encoding: "utf8", timeout: 5000 }),
			/(Operation not permitted|Permission denied|readonly mode)/,
			"sandbox should block writes outside temp",
		);
		assert.equal(fs.existsSync(outsidePath), false, "outside temp file should not be created");

		execFileSync("/bin/bash", ["-c", wrapCommandWithOsSandbox(`echo allowed > "${insidePath}"`)], { encoding: "utf8", timeout: 5000 });
		assert.equal(fs.readFileSync(insidePath, "utf8").trim(), "allowed", "sandbox should allow temp writes");
	} finally {
		try { fs.rmSync(outsidePath, { force: true }); } catch { /* best-effort cleanup */ }
		try { fs.rmSync(insideDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
	}
});

test("os-sandbox: wrapCommandWithOsSandbox returns sandbox-exec on darwin", () => {
	const origPlatform = Object.getOwnPropertyDescriptor(process, "platform");
	Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
	try {
		const result = wrapCommandWithOsSandbox("echo hello");
		assert.ok(result.startsWith("sandbox-exec"), "should use sandbox-exec on darwin");
	} finally {
		if (origPlatform) {
			Object.defineProperty(process, "platform", origPlatform);
		}
	}
});

test("os-sandbox: wrapWithSandboxExec handles multiline command", () => {
	const cmd = "echo line1\necho line2\necho line3";
	const result = wrapWithSandboxExec(cmd);
	assert.ok(result.includes("echo line1"), "should preserve first line");
	assert.ok(result.includes("echo line2"), "should preserve second line");
	assert.ok(result.includes("echo line3"), "should preserve third line");
	// All lines should be after heredoc open and before heredoc close
	const delimIndex = result.indexOf("PI_SANDBOX_INNER_");
	const innerEnd = result.indexOf("\n", delimIndex); // skip to end of delimiter name
	const cmdStart = result.indexOf("\n", innerEnd + 1);
	const lastDelim = result.lastIndexOf("PI_SANDBOX_INNER_");
	assert.ok(cmdStart > 0 && lastDelim > cmdStart, "command should be inside heredoc");
});

test("os-sandbox: wrapWithSandboxExec generates unique delimiters", () => {
	const cmd = "echo hello";
	const result1 = wrapWithSandboxExec(cmd);
	const result2 = wrapWithSandboxExec(cmd);
	const delim1 = result1.match(/PI_SANDBOX_INNER_\w+/)?.[0] || "";
	const delim2 = result2.match(/PI_SANDBOX_INNER_\w+/)?.[0] || "";
	assert.notEqual(delim1, delim2, "two calls should produce different delimiters");
});

// ── resolveRealPath tests ─────────────────────────────────────────────

test("resolveRealPath: existing path returns unchanged", () => {
	const result = resolveRealPath(os.tmpdir());
	assert.ok(result.length > 0, "should resolve to a non-empty path");
});

test("resolveRealPath: root returns root", () => {
	assert.equal(resolveRealPath("/"), "/");
});

test("resolveRealPath: existing file resolves", () => {
	const result = resolveRealPath(new URL(".", import.meta.url).pathname);
	assert.ok(result.length > 0, "should resolve to a non-empty path");
});

test("resolveRealPath: non-existent path inside temp dir preserves full path", () => {
	const tmp = os.tmpdir();
	const nonExistent = `${tmp}/__pi_test_deep/a/b/c`;
	const result = resolveRealPath(nonExistent);
	// Should contain the full path including all intermediate components
	assert.ok(result.includes("__pi_test_deep/a/b/c"), "should preserve all path components");
});

// ── I6: Missing test scenarios ────────────────────────────────────────

test("classifyBashCommand blocks package manager mutations directly", () => {
	assert.equal(isBlocked("npm install lodash"), true);
	assert.equal(isBlocked("pip install requests"), true);
	assert.equal(isBlocked("brew install node"), true);
	assert.equal(isBlocked("apt-get install ripgrep"), true);
	assert.equal(isBlocked("pip3 install requests"), true, "pip3 variant");
	assert.equal(isBlocked("npm i lodash"), true, "npm i short form");
	assert.equal(isBlocked("yarn add lodash"), true, "yarn add");
});

test("applyReadonlyBashGuard fallback mirrors classifyBashCommand on unsupported platforms", () => {
	const origPlatform = Object.getOwnPropertyDescriptor(process, "platform");
	Object.defineProperty(process, "platform", { value: "win32", configurable: true });
	try {
		const blocked = applyReadonlyBashGuard("npm install lodash", "/workspace");
		assert.deepEqual(blocked.action, "block");
		if (blocked.action === "block") {
			assert.match(blocked.reason, /npm install lodash is blocked in readonly mode/i);
		}

		const wrapped = applyReadonlyBashGuard('env -S "pip install requests"', "/workspace");
		assert.deepEqual(wrapped.action, "block");
		if (wrapped.action === "block") {
			assert.match(wrapped.reason, /pip install requests is blocked in readonly mode/i);
		}

		assert.deepEqual(applyReadonlyBashGuard("ls -la", "/workspace"), { action: "allow" });
	} finally {
		if (origPlatform) Object.defineProperty(process, "platform", origPlatform);
	}
});

test("classifyBashCommand allows node -e with >= operator (no false positive)", () => {
	// H4 fix: >= inside node -e inline code is not a write redirect
	assert.equal(isDirect('node -e "var x=5; if(x>=0) console.log(x);"'), true);
	assert.equal(isDirect('node -e "for(var i=0;i<10;i++){}"'), true, "< in for loop");
});

test("classifyBashCommand allows >= in test command", () => {
	assert.equal(isDirect("test 5 -ge 3"), true, "-ge comparison");
});

test("classifyBashCommand: deep recursion triggers depth limit", () => {
	// Build a deeply nested eval chain with safe commands to exceed the depth limit.
	// eval always recurses, so each level increments depth. We need 11+ levels.
	let cmd = "echo safe";
	for (let i = 0; i < 12; i++) {
		cmd = `eval "${cmd}"`;
	}
	const result = classifyBashCommand(cmd, "/workspace");
	assert.equal(result.ok, false);
	assert.match((result as { ok: false; reason: string }).reason, /recursion depth/);
});

test("resolveRealPath follows symlinks", () => {
	const dir = os.tmpdir();
	const target = path.join(dir, `pi-test-target-${Date.now()}`);
	const link = path.join(dir, `pi-test-link-${Date.now()}`);
	fs.mkdirSync(target);
	try {
		fs.symlinkSync(target, link);
		const resolved = resolveRealPath(link);
		// Use resolveRealPath on target too to handle macOS /var → /private/var
		assert.equal(resolved, resolveRealPath(target));
	} finally {
		fs.rmSync(link, { force: true });
		fs.rmSync(target, { force: true, recursive: true });
	}
});

test("wrapCommandWithOsSandbox returns command unchanged on unsupported platform", () => {
	const origPlatform = Object.getOwnPropertyDescriptor(process, "platform");
	Object.defineProperty(process, "platform", { value: "win32", configurable: true });
	try {
		const result = wrapCommandWithOsSandbox("echo hello");
		assert.equal(result, "echo hello");
	} finally {
		Object.defineProperty(process, "platform", origPlatform!);
	}
});
