import os from 'node:os';
import { RED, GREEN, YELLOW, CYAN, DIM, BOLD, NC } from './colors.js';
import { findSettingsFiles, scanFile, ScanResult } from './scanner.js';
import { fixFiles } from './fixer.js';
import { getVersion, notifyUpdate } from './updater.js';
import { mergeByProject, summarize } from './aggregator.js';
import { printCompact, printVerbose, printFooter, printFixResult } from './renderer.js';
import { startInteractive } from './interactive.js';

const HELP = `${CYAN}ccperm${NC} — Audit Claude Code permissions across projects

${YELLOW}Usage:${NC}
  ccperm              Audit current project
  ccperm --all        Audit all projects under ~

${YELLOW}Options:${NC}
  --all               Scan all projects under home directory
  --verbose           Show all permissions per project
  -i, --interactive   Browse permissions interactively
  --help, -h          Show this help
  --version, -v       Show version

${YELLOW}Legacy:${NC}
  --fix          Auto-fix deprecated :* patterns (will be removed once
                 Claude Code patches this upstream)`;

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) { console.log(HELP); return; }
  if (args.includes('--version') || args.includes('-v')) { console.log(getVersion()); return; }

  const isAll = args.includes('--all');
  const isFix = args.includes('--fix');
  const isVerbose = args.includes('--verbose');
  const isInteractive = args.includes('--interactive') || args.includes('-i');

  console.log(`\n  ${CYAN}${BOLD}ccperm${NC} ${DIM}v${getVersion()}${NC}  —  Claude Code Permission Audit\n`);

  const searchDir = isAll ? os.homedir() : process.cwd();
  console.log(`  Scope: ${YELLOW}${isAll ? '~ (all projects)' : searchDir}${NC}`);

  const files = findSettingsFiles(searchDir);
  if (files.length === 0) { console.log(`  ${GREEN}✔ No settings files found.${NC}\n`); return; }
  console.log(`  Found ${CYAN}${files.length}${NC} settings files\n`);

  const results: ScanResult[] = files.map(scanFile).filter((r): r is ScanResult => r !== null);
  const merged = mergeByProject(results);
  const summary = summarize(results);

  if (isInteractive) {
    if (!process.stdin.isTTY) {
      console.error(`  ${RED}Error: --interactive requires a TTY terminal.${NC}\n`);
      process.exit(1);
    }
    await startInteractive(merged, results);
    return;
  }

  if (isVerbose) { printVerbose(results, summary); } else { printCompact(merged, summary); }
  printFooter(summary);

  if (summary.deprecatedTotal === 0) { return; }
  if (!isFix) {
    const verboseHint = isVerbose ? '' : `\n  ${DIM}Use ${NC}--verbose${DIM} to see all permissions${NC}`;
    console.log(`\n  Run with ${YELLOW}--fix${NC} to auto-fix.${verboseHint}\n`);
    process.exit(1);
  }

  console.log('');
  printFixResult(fixFiles(summary.affectedFiles));
}

main();
notifyUpdate();
