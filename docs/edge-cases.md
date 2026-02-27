# Claude Code Permission Edge Cases

Known quirks in Claude Code's permission system that affect how permissions work in practice.

## Glob `*` doesn't match special characters

The `*` in permission patterns (e.g., `Bash(curl *)`) does **not** match newlines, pipes, or shell operators. The entire compound command is matched as a single string against the pattern.

**Fails to match:**
- **Pipes:** `curl ... | python3 ...` won't match `curl *`
- **Chaining:** `git add X && git commit Y` won't match `git add *` or `git commit *`
- **HEREDOC:** `git commit -m "$(cat <<'EOF'\n...\nEOF\n)"` won't match `git commit *`
- **Redirects:** `echo foo 2>/dev/null | head` may not match `echo *`

**Result:** Users get prompted every time, even with the permission already allowed.

**Workaround:** Use single, non-piped commands where possible. Split compound commands into separate calls.

## Global permissions aren't checked on project approval

When Claude Code adds a permission to a project's `.claude/settings.json`, it does **not** check if the same permission already exists in the global `~/.claude/settings.json`.

**Impact:**
- Permissions like `git add *`, `curl *` accumulate across many project files redundantly
- Example: `curl *` in global + 13 project files = 13 unnecessary entries

**Detection:** ccperm shows these as `(in global)` tags in the TUI detail view and counts them in the `G` column.

## `:*` deprecated pattern

Old format `Bash(git add:*)` (colon) is deprecated in favor of `Bash(git add *)` (space).

**Detection:** ccperm shows `†` column in list view. Use `ccperm --fix` to auto-convert.
