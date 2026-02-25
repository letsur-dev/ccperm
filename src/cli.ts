import os from 'node:os';
import { RED, GREEN, YELLOW, CYAN, DIM, BOLD, NC } from './colors.js';
import { findSettingsFiles, scanFile, ScanResult, DEPRECATED_PERM_RE } from './scanner.js';
import { fixFiles } from './fixer.js';
import { getVersion, notifyUpdate } from './updater.js';

const HELP = `${CYAN}ccperm${NC} — Audit Claude Code permissions across projects

${YELLOW}Usage:${NC}
  ccperm              Audit current project
  ccperm --all        Audit all projects under ~

${YELLOW}Options:${NC}
  --all          Scan all projects under home directory
  --verbose      Show all permissions per project
  --help, -h     Show this help
  --version, -v  Show version

${YELLOW}Legacy:${NC}
  --fix          Auto-fix deprecated :* patterns (will be removed once
                 Claude Code patches this upstream)`;

function shortPath(display: string): string {
  // ~/Documents/wecouldbe/ccperm/.claude/settings.local.json → ccperm
  const m = display.match(/\/([^/]+)\/\.claude\//);
  return m ? m[1] : display;
}

function projectDir(display: string): string {
  // ~/Documents/wecouldbe/ccperm/.claude/settings.local.json → ~/Documents/wecouldbe/ccperm
  const idx = display.indexOf('/.claude/');
  return idx >= 0 ? display.slice(0, idx) : display;
}

interface MergedResult {
  display: string;
  shortName: string;
  totalCount: number;
  deprecatedCount: number;
  groups: Map<string, number>;
}

function mergeByProject(results: ScanResult[]): MergedResult[] {
  const map = new Map<string, MergedResult>();
  for (const r of results) {
    const dir = projectDir(r.display);
    let merged = map.get(dir);
    if (!merged) {
      merged = { display: r.display, shortName: shortPath(r.display), totalCount: 0, deprecatedCount: 0, groups: new Map() };
      map.set(dir, merged);
    }
    merged.totalCount += r.totalCount;
    merged.deprecatedCount += r.deprecatedCount;
    for (const g of r.groups) {
      merged.groups.set(g.category, (merged.groups.get(g.category) || 0) + g.items.length);
    }
  }
  return [...map.values()];
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function rpad(s: string | number, n: number): string {
  const str = String(s);
  return str.length >= n ? str : ' '.repeat(n - str.length) + str;
}

function printCompact(results: ScanResult[]) {
  const merged = mergeByProject(results);
  const cats = ['Bash', 'WebFetch', 'MCP', 'Tools'];
  const catsPresent = cats.filter((c) =>
    merged.some((r) => r.groups.has(c))
  );

  const withPerms = merged.filter((r) => r.totalCount > 0).sort((a, b) => b.totalCount - a.totalCount);
  const emptyCount = merged.filter((r) => r.totalCount === 0).length;

  // header
  const nameWidth = Math.min(
    Math.max(...withPerms.map((r) => r.shortName.length), 7),
    40
  );
  const header = `  ${DIM}${pad('PROJECT', nameWidth)}  ${catsPresent.map((c) => rpad(c, 5)).join('  ')}  TOTAL${NC}`;
  console.log(header);
  console.log(`  ${DIM}${'─'.repeat(nameWidth + catsPresent.length * 7 + 8)}${NC}`);

  // rows
  for (const result of withPerms) {
    const truncName = result.shortName.length > nameWidth ? result.shortName.slice(0, nameWidth - 1) + '…' : result.shortName;
    const hasDeprecated = result.deprecatedCount > 0;
    const marker = hasDeprecated ? `${RED}✖ ` : '  ';
    const nameCol = hasDeprecated
      ? `${marker}${pad(truncName, nameWidth)}${NC}`
      : `  ${DIM}${pad(truncName, nameWidth)}${NC}`;

    const catCols = catsPresent.map((c) => {
      const count = result.groups.get(c) || 0;
      return count > 0 ? rpad(count, 5) : `${DIM}${rpad('·', 5)}${NC}`;
    }).join('  ');

    const totalCol = rpad(result.totalCount, 5);
    console.log(`${nameCol}  ${catCols}  ${BOLD}${totalCol}${NC}`);
  }

  if (emptyCount > 0) {
    console.log(`\n  ${DIM}+ ${emptyCount} projects with no permissions${NC}`);
  }
}

function printVerbose(results: ScanResult[]) {
  const projectsWithPerms = results.filter((r) => r.totalCount > 0);
  const projectsEmpty = results.filter((r) => r.totalCount === 0);

  for (const result of projectsWithPerms) {
    const summary = result.groups.map((g) => `${g.category}: ${g.items.length}`).join(', ');
    console.log(`  ${CYAN}${result.display}${NC}`);
    console.log(`  ${DIM}${summary}${NC}`);
    for (const group of result.groups) {
      console.log(`    ${YELLOW}${group.category}${NC} ${DIM}(${group.items.length})${NC}`);
      for (const item of group.items) {
        if (item.deprecated) {
          console.log(`      ${RED}✖ ${item.name}${NC}  ${RED}← deprecated${NC}`);
        } else {
          console.log(`      ${DIM}${item.name}${NC}`);
        }
      }
    }
    console.log('');
  }

  if (projectsEmpty.length > 0) {
    console.log(`  ${DIM}+ ${projectsEmpty.length} files with no permissions${NC}\n`);
  }
}

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

  const isAll = args.includes('--all');
  const isFix = args.includes('--fix');
  const isVerbose = args.includes('--verbose');

  console.log(`\n  ${CYAN}${BOLD}ccperm${NC} ${DIM}v${getVersion()}${NC}  —  Claude Code Permission Audit\n`);

  const searchDir = isAll ? os.homedir() : process.cwd();
  console.log(`  Scope: ${YELLOW}${isAll ? '~ (all projects)' : searchDir}${NC}`);

  const files = findSettingsFiles(searchDir);

  if (files.length === 0) {
    console.log(`  ${GREEN}✔ No settings files found.${NC}\n`);
    process.exit(0);
  }

  console.log(`  Found ${CYAN}${files.length}${NC} settings files\n`);

  const results: ScanResult[] = [];
  let deprecatedTotal = 0;
  let deprecatedFiles = 0;
  const affectedFiles: { path: string; count: number }[] = [];
  const categoryTotals = new Map<string, number>();

  for (const f of files) {
    const result = scanFile(f);
    if (!result) continue;
    results.push(result);

    if (result.deprecatedCount > 0) {
      deprecatedTotal += result.deprecatedCount;
      deprecatedFiles++;
      affectedFiles.push({ path: result.path, count: result.deprecatedCount });
    }

    for (const group of result.groups) {
      categoryTotals.set(group.category, (categoryTotals.get(group.category) || 0) + group.items.length);
    }
  }

  // print results
  if (isVerbose) {
    printVerbose(results);
  } else {
    printCompact(results);
  }

  // footer summary
  console.log(`\n  ${DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);

  const projectsWithPerms = results.filter((r) => r.totalCount > 0).length;
  const totalPerms = [...categoryTotals.values()].reduce((a, b) => a + b, 0);
  const catSummary = [...categoryTotals.entries()].map(([k, v]) => `${k}: ${BOLD}${v}${NC}${DIM}`).join('  ');
  console.log(`  ${BOLD}${projectsWithPerms}${NC} projects  ${BOLD}${totalPerms}${NC} permissions  ${DIM}(${catSummary})${NC}`);

  if (deprecatedTotal === 0) {
    console.log(`  ${GREEN}✔ All clean — no deprecated patterns${NC}\n`);
    process.exit(0);
  }

  console.log(`  ${RED}✖ ${deprecatedTotal} deprecated patterns in ${deprecatedFiles} files${NC}`);

  if (!isFix) {
    const verboseHint = isVerbose ? '' : `\n  ${DIM}Use ${NC}--verbose${DIM} to see all permissions${NC}`;
    console.log(`\n  Run with ${YELLOW}--fix${NC} to auto-fix.${verboseHint}\n`);
    process.exit(1);
  }

  console.log('');
  const { totalPatterns, fixedFiles } = fixFiles(affectedFiles);
  console.log(`  ${GREEN}✔ Fixed ${totalPatterns} patterns in ${fixedFiles} files.${NC}`);
  console.log(`  ${DIM}Start a new session for changes to take effect.${NC}\n`);

  notifyUpdate();
}

main();
notifyUpdate();
