# ccperm

Fix deprecated Claude Code permission patterns.

Claude Code's "Allow always" button saves permissions with `:*` instead of ` *`, causing permission popups to repeat. This tool detects and fixes the issue.

## Usage

```bash
npx ccperm              # Check current project
npx ccperm --all        # Check all projects under ~
npx ccperm --fix        # Fix current project
npx ccperm --all --fix  # Fix all projects under ~
```

## What it does

1. Finds `.claude/settings*.json` files
2. Detects deprecated `:*` permission patterns (e.g. `Bash(npm run build:*)`)
3. Fixes them to correct ` *` format (e.g. `Bash(npm run build *)`)

## Requirements

- Node.js >= 18
- macOS or Linux

## License

MIT
