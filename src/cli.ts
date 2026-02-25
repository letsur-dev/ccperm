import os from 'node:os';
import { RED, GREEN, YELLOW, CYAN, DIM, NC } from './colors.js';
import { findSettingsFiles, scanFile, DEPRECATED_PERM_RE } from './scanner.js';
import { fixFiles } from './fixer.js';
import { checkUpdate, getVersion } from './updater.js';

const HELP = `${CYAN}ccperm${NC} — Fix deprecated Claude Code permission patterns

${YELLOW}Usage:${NC}
  ccperm              Check current project
  ccperm --all        Check all projects under ~
  ccperm --fix        Fix current project
  ccperm --all --fix  Fix all projects under ~

${YELLOW}Options:${NC}
  --all          Scan all projects under home directory
  --fix          Auto-fix deprecated :* patterns
  --help, -h     Show this help
  --version, -v  Show version
  --update       Check for updates

${YELLOW}What it does:${NC}
  Claude Code's "Allow always" saves permissions with ${RED}:*${NC} instead of ${GREEN} *${NC},
  causing permission popups to repeat. This tool detects and fixes the issue.`;

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP);
    process.exit(0);
  }

  if (args.includes('--version') || args.includes('-v')) {
    console.log(getVersion());
    process.exit(0);
  }

  if (args.includes('--update')) {
    const update = await checkUpdate();
    if (update) {
      console.log(`${YELLOW}Update available: ${update.current} → ${update.latest}${NC}`);
      console.log(`Run ${CYAN}npm i -g ccperm${NC} to update.`);
    } else {
      console.log(`${GREEN}You're on the latest version (${getVersion()}).${NC}`);
    }
    process.exit(0);
  }

  const isAll = args.includes('--all');
  const isFix = args.includes('--fix');

  console.log(`${CYAN}━━━ Claude Code Permission Fixer ━━━${NC}\n`);

  const searchDir = isAll ? os.homedir() : process.cwd();
  console.log(`Scope: ${YELLOW}${isAll ? '~ (all projects)' : searchDir}${NC}`);

  const files = findSettingsFiles(searchDir);

  if (files.length === 0) {
    console.log(`${GREEN}No settings files found.${NC}`);
    process.exit(0);
  }

  console.log(`Scanned ${CYAN}${files.length}${NC} files:\n`);

  let total = 0;
  let affected = 0;
  const affectedFiles: { path: string; count: number }[] = [];

  for (const f of files) {
    const result = scanFile(f);
    if (!result) continue;

    if (result.deprecatedCount > 0) {
      total += result.deprecatedCount;
      affected++;
      affectedFiles.push({ path: result.path, count: result.deprecatedCount });
    }

    if (result.permissions.length > 0) {
      console.log(`  ${CYAN}${result.display}${NC}`);
      for (const p of result.permissions) {
        if (DEPRECATED_PERM_RE.test(p)) {
          console.log(`    ${RED}${p}${NC}  ← deprecated`);
        } else {
          console.log(`    ${DIM}${p}${NC}`);
        }
      }
    } else {
      console.log(`  ${DIM}${result.display}  (no permissions)${NC}`);
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  if (total === 0) {
    console.log(`${GREEN}All clean! No deprecated :* patterns found.${NC}`);
    process.exit(0);
  }

  console.log(`${RED}Found ${total} deprecated patterns in ${affected} files.${NC}`);

  if (!isFix) {
    console.log(`\nRun with ${YELLOW}--fix${NC} to auto-fix.`);
    process.exit(1);
  }

  console.log('');
  const { totalPatterns, fixedFiles } = fixFiles(affectedFiles);
  console.log(`${GREEN}Fixed ${totalPatterns} patterns in ${fixedFiles} files.${NC}`);
  console.log(`${CYAN}Start a new session for changes to take effect.${NC}`);

  // non-blocking update check after fix
  checkUpdate().then((update) => {
    if (update) {
      console.log(`\n${YELLOW}Update available: ${update.current} → ${update.latest}${NC}`);
      console.log(`Run ${CYAN}npm i -g ccperm${NC} to update.`);
    }
  }).catch(() => {});
}

main();
