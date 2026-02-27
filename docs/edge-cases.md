# Claude Code Permission Edge Cases

Known quirks in Claude Code's permission system that affect how permissions work in practice.

## Glob `*` doesn't match shell operators

The `*` in permission patterns (e.g., `Bash(curl *)`) does **not** match newlines, pipes, or shell operators. The entire compound command is matched as a single string against the pattern.

**Fails to match:**
- **Pipes:** `curl ... | python3 ...` won't match `curl *`
- **Chaining:** `git add X && git commit Y` won't match `git add *` or `git commit *`
- **HEREDOC:** `git commit -m "$(cat <<'EOF'\n...\nEOF\n)"` won't match `git commit *`
- **Redirects:** `echo foo 2>/dev/null | head` may not match `echo *`

**Result:** Users get prompted every time, even with the permission already allowed.

**Workaround:** Use single, non-piped commands where possible. Split compound commands into separate calls.

### Upstream issues

This is a widely reported problem with many open issues on [anthropics/claude-code](https://github.com/anthropics/claude-code):

| Issue | Type | Summary |
|-------|------|---------|
| [#11775](https://github.com/anthropics/claude-code/issues/11775) | pipe | Plan agent repeatedly prompts for piped commands |
| [#28275](https://github.com/anthropics/claude-code/issues/28275) | pipe | Allowlist fails to match piped commands |
| [#28036](https://github.com/anthropics/claude-code/issues/28036) | pipe | "Don't ask again" suggests wrong command (last pipe segment) |
| [#14595](https://github.com/anthropics/claude-code/issues/14595) | pipe | Inconsistent: `pwd \| awk` fails but `pwd \| sed` works |
| [#28784](https://github.com/anthropics/claude-code/issues/28784) | && | **Security**: `cd:*` allows `cd && python3 script.py` |
| [#16180](https://github.com/anthropics/claude-code/issues/16180) | && | Only first command validated, rest bypassed |
| [#25441](https://github.com/anthropics/claude-code/issues/25441) | heredoc | Full heredoc content saved verbatim to settings.json |
| [#15742](https://github.com/anthropics/claude-code/issues/15742) | heredoc | Multiline patterns corrupt settings.json |
| [#29085](https://github.com/anthropics/claude-code/issues/29085) | design | "Permission rules model needs fundamental rethink" |
| [#16561](https://github.com/anthropics/claude-code/issues/16561) | feature | Parse compound commands, match each component individually |

### Security concerns

- `deny` rules can be bypassed with multiline commands (#25441)
- `&&` chains may only validate the first command (#16180, #28784)

### Partial fixes by Anthropic

- **v2.1.47**: Fixed multiline "always allow" creating invalid patterns
- **v2.1.59**: Improved per-subcommand prefix suggestion for compound commands
- Root cause (shell-aware parsing) remains **unresolved**

### Community workarounds

- [claude-code-plus](https://github.com/AbdelrahmanHafez/claude-code-plus) — PreToolUse hook using `shfmt` to parse pipes and match each component
- [claude-code-permissions-hook](https://github.com/kornysietsma/claude-code-permissions-hook) — Rust/TOML regex-based allow/deny rules

## Global permissions aren't checked on project approval

When Claude Code adds a permission to a project's `.claude/settings.json`, it does **not** check if the same permission already exists in the global `~/.claude/settings.json`.

**Impact:**
- Permissions like `git add *`, `curl *` accumulate across many project files redundantly
- Example: `curl *` in global + 13 project files = 13 unnecessary entries

**Detection:** ccperm shows these as `(in global)` tags in the TUI detail view and counts them in the `G` column.

## `:*` deprecated pattern

Old format `Bash(git add:*)` (colon) is deprecated in favor of `Bash(git add *)` (space).

**Detection:** ccperm shows `†` column in list view. Use `ccperm --fix` to auto-convert.
