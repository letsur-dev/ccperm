import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { RED, GREEN, YELLOW, CYAN, DIM, BOLD, NC } from './colors.js';
import { findSettingsFiles, scanFile, ScanResult, countDeprecated } from './scanner.js';
import { fixFiles } from './fixer.js';
import { getVersion, notifyUpdate } from './updater.js';
import { toFileEntries, summarize } from './aggregator.js';
import { printCompact, printVerbose, printFooter } from './renderer.js';
import { startInteractive } from './interactive.js';
import { analyze } from './advisor.js';

const KNOWN_FLAGS = new Set(['--cwd', '--verbose', '--static', '--update', '--fix', '--hey-claude-witness-me', '--debug', '--help', '-h', '--version', '-v']);

const HELP = `${CYAN}ccperm${NC} — Audit Claude Code permissions across projects

${YELLOW}Usage:${NC}
  ccperm              Audit all projects under ~
  ccperm --cwd        Audit current directory only

${YELLOW}Options:${NC}
  --cwd               Scan current directory only (default: all)
  --verbose           Show all permissions per project (static)
  --static            Force static output (default in non-TTY)
  --update            Update ccperm to latest version
  --hey-claude-witness-me
                      Dump a markdown briefing so your AI can
                      judge your permission hygiene. It will.
  --help, -h          Show this help
  --version, -v       Show version

${DIM}Pro tip: pipe --hey-claude-witness-me into Claude and watch it roast your settings.
  $ ccperm --hey-claude-witness-me | pbcopy   # then paste into your AI of choice${NC}`;

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) { console.log(HELP); return; }
  if (args.includes('--version') || args.includes('-v')) { console.log(getVersion()); return; }

  if (args.includes('--update')) {
    const before = getVersion();
    console.log(`  Updating ccperm from ${DIM}v${before}${NC}...\n`);
    try {
      execFileSync('npm', ['install', '-g', 'ccperm@latest'], { stdio: 'inherit' });
      const after = execFileSync('ccperm', ['-v'], { encoding: 'utf8' }).trim();
      if (after === before) {
        console.log(`\n  ${GREEN}✔ Already up to date. ${BOLD}v${after}${NC}`);
      } else {
        console.log(`\n  ${GREEN}✔ Updated! ${DIM}v${before}${NC} → ${GREEN}${BOLD}v${after}${NC}`);
      }
    } catch {
      console.error(`\n  ${RED}Update failed. Try manually: npm install -g ccperm@latest${NC}\n`);
      process.exit(1);
    }
    return;
  }

  const unknown = args.filter((a) => !KNOWN_FLAGS.has(a));
  if (unknown.length > 0) {
    console.error(`  ${RED}Unknown option: ${unknown.join(', ')}${NC}\n`);
    console.log(HELP);
    process.exit(1);
  }

  const isCwd = args.includes('--cwd');
  const isVerbose = args.includes('--verbose');
  const isStatic = args.includes('--static') || !process.stdout.isTTY;
  console.log(`\n  ${CYAN}${BOLD}ccperm${NC} ${DIM}v${getVersion()}${NC}  —  Claude Code Permission Audit\n`);

  const searchDir = isCwd ? process.cwd() : os.homedir();
  console.log(`  Scope: ${YELLOW}${isCwd ? searchDir : '~ (all projects)'}${NC}`);

  const isTTY = process.stdout.isTTY;
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let frame = 0;
  let fileCount = 0;

  const spinner = isTTY ? setInterval(() => {
    const countText = fileCount > 0 ? ` ${BOLD}${fileCount}${NC} found` : '';
    process.stdout.write(`\r  ${CYAN}${frames[frame++ % frames.length]}${NC} Scanning...${countText}`);
  }, 80) : null;

  const isDebug = args.includes('--debug');
  const onProgress = (count: number) => { fileCount = count; };
  const files = await findSettingsFiles(searchDir, onProgress, isDebug);

  if (spinner) { clearInterval(spinner); process.stdout.write('\r\x1b[K'); }
  if (files.length === 0) { console.log(`  ${GREEN}✔ No settings files found.${NC}\n`); return; }
  console.log(`  ${GREEN}✔${NC} Found ${CYAN}${files.length}${NC} settings files\n`);

  const results: ScanResult[] = files.map(scanFile).filter((r): r is ScanResult => r !== null);

  if (args.includes('--hey-claude-witness-me')) {
    console.log(analyze(results));
    return;
  }

  const entries = toFileEntries(results);
  const summary = summarize(results);

  if (args.includes('--fix')) {
    const affected = countDeprecated(results);
    if (affected.length === 0) { console.log(`  ${GREEN}✔ Nothing to fix.${NC}\n`); return; }
    const { totalPatterns, fixedFiles } = fixFiles(affected);
    console.log(`  ${GREEN}✔ Fixed ${totalPatterns} patterns in ${fixedFiles} files.${NC}`);
    console.log(`  ${DIM}Restart Claude Code for changes to take effect.${NC}\n`);
    return;
  }

  if (!isStatic) {
    await startInteractive(entries, results);
    return;
  }

  if (isVerbose) { printVerbose(results, summary); } else { printCompact(entries, summary); }
  printFooter(summary);
}

main();
notifyUpdate();
