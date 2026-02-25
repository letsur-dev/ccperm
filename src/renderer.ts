import { YELLOW, CYAN, DIM, BOLD, NC } from './colors.js';
import { ScanResult } from './scanner.js';
import { MergedResult, AuditSummary } from './aggregator.js';

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function rpad(s: string | number, n: number): string {
  const str = String(s);
  return str.length >= n ? str : ' '.repeat(n - str.length) + str;
}

export function printCompact(merged: MergedResult[], summary: AuditSummary): void {
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
    const nameCol = `  ${DIM}${pad(truncName, nameWidth)}${NC}`;

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

export function printVerbose(results: ScanResult[], summary: AuditSummary): void {
  const projectsWithPerms = results.filter((r) => r.totalCount > 0);
  const projectsEmpty = results.filter((r) => r.totalCount === 0);

  for (const result of projectsWithPerms) {
    const summaryLine = result.groups.map((g) => `${g.category}: ${g.items.length}`).join(', ');
    console.log(`  ${CYAN}${result.display}${NC}`);
    console.log(`  ${DIM}${summaryLine}${NC}`);
    for (const group of result.groups) {
      console.log(`    ${YELLOW}${group.category}${NC} ${DIM}(${group.items.length})${NC}`);
      for (const item of group.items) {
        console.log(`      ${DIM}${item.name}${NC}`);
      }
    }
    console.log('');
  }

  if (projectsEmpty.length > 0) {
    console.log(`  ${DIM}+ ${projectsEmpty.length} files with no permissions${NC}\n`);
  }
}

export function printFooter(summary: AuditSummary): void {
  console.log(`\n  ${DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);

  const catSummary = [...summary.categoryTotals.entries()].map(([k, v]) => `${k}: ${BOLD}${v}${NC}${DIM}`).join('  ');
  console.log(`  ${BOLD}${summary.projectsWithPerms}${NC} projects  ${BOLD}${summary.totalPerms}${NC} permissions  ${DIM}(${catSummary})${NC}\n`);
}
