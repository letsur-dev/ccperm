import readline from 'node:readline';
import { RED, GREEN, YELLOW, CYAN, DIM, BOLD, NC } from './colors.js';
import { MergedResult } from './aggregator.js';
import { ScanResult } from './scanner.js';

interface TuiState {
  view: 'list' | 'detail';
  cursor: number;
  scrollOffset: number;
  selectedProject: number;
}

export function startInteractive(
  merged: MergedResult[],
  results: ScanResult[],
): Promise<void> {
  return new Promise((resolve) => {
    const withPerms = merged.filter((r) => r.totalCount > 0).sort((a, b) => b.totalCount - a.totalCount);
    const emptyCount = merged.filter((r) => r.totalCount === 0).length;

    if (withPerms.length === 0) {
      console.log(`\n  ${GREEN}No projects with permissions found.${NC}\n`);
      resolve();
      return;
    }

    const state: TuiState = { view: 'list', cursor: 0, scrollOffset: 0, selectedProject: 0 };

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();

    const cleanup = () => {
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener('keypress', onKey);
      process.removeListener('SIGINT', onSigint);
      // show cursor
      process.stdout.write('\x1b[?25h');
    };

    const onSigint = () => {
      cleanup();
      process.exit(0);
    };
    process.on('SIGINT', onSigint);

    const render = () => {
      // clear screen + move cursor home + hide cursor
      process.stdout.write('\x1b[2J\x1b[H\x1b[?25l');
      if (state.view === 'list') renderList(state, withPerms, emptyCount);
      else renderDetail(state, withPerms, results);
    };

    const onKey = (_str: string | undefined, key: readline.Key) => {
      if (!key) return;

      if (key.name === 'q') {
        cleanup();
        console.log('');
        resolve();
        return;
      }

      if (state.view === 'list') {
        if (key.name === 'up') {
          state.cursor = Math.max(0, state.cursor - 1);
        } else if (key.name === 'down') {
          state.cursor = Math.min(withPerms.length - 1, state.cursor + 1);
        } else if (key.name === 'return') {
          state.selectedProject = state.cursor;
          state.view = 'detail';
        }
      } else {
        // detail view
        if (key.name === 'escape' || key.name === 'backspace') {
          state.view = 'list';
        }
      }

      render();
    };

    process.stdin.on('keypress', onKey);
    render();
  });
}

function renderList(state: TuiState, withPerms: MergedResult[], emptyCount: number): void {
  const rows = process.stdout.rows || 24;
  const cols = process.stdout.columns || 80;
  const cats = ['Bash', 'WebFetch', 'MCP', 'Tools'];
  const catsPresent = cats.filter((c) => withPerms.some((r) => r.groups.has(c)));

  const nameWidth = Math.min(
    Math.max(...withPerms.map((r) => r.shortName.length), 7),
    40,
  );

  // header takes 4 lines, footer takes 3 lines
  const headerLines = 4;
  const footerLines = 3 + (emptyCount > 0 ? 1 : 0);
  const visibleRows = Math.max(1, rows - headerLines - footerLines);

  // adjust scroll offset
  if (state.cursor < state.scrollOffset) state.scrollOffset = state.cursor;
  if (state.cursor >= state.scrollOffset + visibleRows) state.scrollOffset = state.cursor - visibleRows + 1;

  const lines: string[] = [];

  lines.push(`  ${CYAN}${BOLD}ccperm${NC} ${DIM}interactive${NC}\n`);
  lines.push(`  ${DIM}${pad('PROJECT', nameWidth)}  ${catsPresent.map((c) => rpad(c, 5)).join('  ')}  TOTAL${NC}`);
  lines.push(`  ${DIM}${'─'.repeat(nameWidth + catsPresent.length * 7 + 8)}${NC}`);

  const end = Math.min(state.scrollOffset + visibleRows, withPerms.length);
  for (let i = state.scrollOffset; i < end; i++) {
    const r = withPerms[i];
    const isCursor = i === state.cursor;
    const truncName = r.shortName.length > nameWidth ? r.shortName.slice(0, nameWidth - 1) + '…' : r.shortName;

    const marker = isCursor ? `${CYAN}> ` : '  ';
    const nameStyle = isCursor ? `${BOLD}` : `${DIM}`;
    const nameCol = `${marker}${nameStyle}${pad(truncName, nameWidth)}${NC}`;

    const catCols = catsPresent.map((c) => {
      const count = r.groups.get(c) || 0;
      if (count > 0) return isCursor ? `${BOLD}${rpad(count, 5)}${NC}` : rpad(count, 5);
      return `${DIM}${rpad('·', 5)}${NC}`;
    }).join('  ');

    const totalCol = isCursor ? `${BOLD}${rpad(r.totalCount, 5)}${NC}` : rpad(r.totalCount, 5);
    lines.push(`${nameCol}  ${catCols}  ${totalCol}`);
  }

  if (emptyCount > 0) {
    lines.push(`\n  ${DIM}+ ${emptyCount} projects with no permissions${NC}`);
  }

  lines.push('');
  lines.push(`  ${DIM}[↑↓] navigate  [Enter] detail  [q] quit${NC}`);

  process.stdout.write(lines.join('\n') + '\n');
}

function renderDetail(state: TuiState, withPerms: MergedResult[], results: ScanResult[]): void {
  const project = withPerms[state.selectedProject];
  if (!project) return;

  // find ScanResults belonging to this project
  const projectResults = results.filter((r) => {
    const idx = r.display.indexOf('/.claude/');
    const dir = idx >= 0 ? r.display.slice(0, idx) : r.display;
    const projIdx = project.display.indexOf('/.claude/');
    const projDir = projIdx >= 0 ? project.display.slice(0, projIdx) : project.display;
    return dir === projDir;
  });

  const lines: string[] = [];

  lines.push(`  ${CYAN}${BOLD}${project.shortName}${NC}  ${DIM}(${project.totalCount} permissions)${NC}\n`);

  for (const result of projectResults) {
    if (result.totalCount === 0) continue;
    lines.push(`  ${DIM}${result.display}${NC}`);
    for (const group of result.groups) {
      lines.push(`    ${YELLOW}${group.category}${NC} ${DIM}(${group.items.length})${NC}`);
      for (const item of group.items) {
        if (item.deprecated) {
          lines.push(`      ${RED}✖ ${item.name}${NC}  ${RED}← deprecated${NC}`);
        } else {
          lines.push(`      ${DIM}${item.name}${NC}`);
        }
      }
    }
    lines.push('');
  }

  lines.push(`  ${DIM}[Esc/Backspace] back  [q] quit${NC}`);

  process.stdout.write(lines.join('\n') + '\n');
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function rpad(s: string | number, n: number): string {
  const str = String(s);
  return str.length >= n ? str : ' '.repeat(n - str.length) + str;
}
