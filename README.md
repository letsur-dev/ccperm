# ccperm

Audit Claude Code permissions across all your projects.

[한국어](README.ko.md)

Claude Code stores allowed permissions (Bash commands, WebFetch domains, MCP tools, etc.) in `.claude/settings*.json` per project. As you work across many projects, these permissions pile up silently. **ccperm** lets you see exactly what you've allowed, everywhere.

## Quick Start

```bash
npx ccperm --all
```

No install needed. Or install globally:

```bash
npm i -g ccperm
ccperm --all
```

## Usage

```bash
npx ccperm              # Audit current project
npx ccperm --all        # Audit all projects under ~
npx ccperm --fix        # Auto-fix deprecated patterns
npx ccperm --all --fix  # Audit + fix all projects
```

## Output example

```
━━━ Claude Code Permission Audit ━━━

Scope: ~ (all projects)
Scanned 12 files:

  ~/Documents/project-a/.claude/settings.local.json  (Bash: 5, WebFetch: 3, Tools: 1)
    Bash (5)
      npm run build *
      docker compose *
      curl *
      git add *
      ssh *
    WebFetch (3)
      github.com
      docs.anthropic.com
      api.example.com
    Tools (1)
      WebSearch

  ~/Documents/project-b/.claude/settings.local.json  (Bash: 2, MCP: 3)
    Bash (2)
      python3 *
      pytest *
    MCP (3)
      browseros__browser_navigate
      browseros__browser_click_element
      browseros__browser_get_screenshot

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
All clean! No deprecated :* patterns found.
```

## Options

| Flag | Description |
|------|-------------|
| `--all` | Scan all projects under home directory |
| `--fix` | Auto-fix deprecated `:*` patterns to ` *` |
| `--help`, `-h` | Show help |
| `--version`, `-v` | Show version |
| `--update` | Check for updates |

## Deprecated pattern fix

Claude Code previously saved "Allow always" permissions with `:*` instead of ` *`, causing permission popups to repeat. `--fix` detects and corrects this automatically.

```
Before: Bash(npm run build:*)
After:  Bash(npm run build *)
```

## Requirements

- Node.js >= 18
- macOS or Linux

## License

MIT
