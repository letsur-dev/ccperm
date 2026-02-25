import readline from 'node:readline';
import { GREEN, YELLOW, CYAN, DIM, BOLD, NC } from './colors.js';
import { MergedResult } from './aggregator.js';
import { ScanResult } from './scanner.js';

interface DetailRow {
  type: 'file' | 'category' | 'item';
  label: string;
  key?: string; // for toggle
  indent: number;
}

interface TuiState {
  view: 'list' | 'detail';
  cursor: number;
  scrollOffset: number;
  selectedProject: number;
  detailCursor: number;
  detailScroll: number;
  expanded: Set<string>;
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

    const state: TuiState = { view: 'list', cursor: 0, scrollOffset: 0, selectedProject: 0, detailCursor: 0, detailScroll: 0, expanded: new Set() };

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
          state.detailCursor = 0;
          state.detailScroll = 0;
          state.expanded = new Set();
          state.view = 'detail';
        }
      } else {
        // detail view
        if (key.name === 'escape' || key.name === 'backspace') {
          state.view = 'list';
          state.detailCursor = 0;
          state.detailScroll = 0;
        } else if (key.name === 'up') {
          state.detailCursor = Math.max(0, state.detailCursor - 1);
        } else if (key.name === 'down') {
          state.detailCursor++;
        } else if (key.name === 'return') {
          // toggle handled in renderDetail via detailRows
          (state as any)._toggle = true;
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
  const rows = process.stdout.rows || 24;
  const cols = process.stdout.columns || 80;
  const project = withPerms[state.selectedProject];
  if (!project) return;

  const projectResults = results.filter((r) => {
    const idx = r.display.indexOf('/.claude/');
    const dir = idx >= 0 ? r.display.slice(0, idx) : r.display;
    const projIdx = project.display.indexOf('/.claude/');
    const projDir = projIdx >= 0 ? project.display.slice(0, projIdx) : project.display;
    return dir === projDir;
  });

  // build navigable rows
  const navRows: { line: string; key?: string }[] = [];
  for (const result of projectResults) {
    if (result.totalCount === 0) continue;
    const fileName = result.display.replace(/.*\/\.claude\//, '');
    navRows.push({ line: `  ${CYAN}${fileName}${NC}  ${DIM}(${result.totalCount})${NC}` });
    for (const group of result.groups) {
      const key = `${result.path}:${group.category}`;
      const isOpen = state.expanded.has(key);
      const arrow = isOpen ? '▾' : '▸';
      navRows.push({ line: `    ${YELLOW}${arrow} ${group.category}${NC} ${DIM}(${group.items.length})${NC}`, key });
      if (isOpen) {
        const maxLen = cols - 10;
        for (const item of group.items) {
          const name = item.name.length > maxLen ? item.name.slice(0, maxLen - 1) + '…' : item.name;
          navRows.push({ line: `      ${DIM}${name}${NC}` });
        }
      }
    }
  }

  // handle toggle
  if ((state as any)._toggle) {
    delete (state as any)._toggle;
    const row = navRows[state.detailCursor];
    if (row?.key) {
      if (state.expanded.has(row.key)) state.expanded.delete(row.key);
      else state.expanded.add(row.key);
      // re-render needed — will happen on next render() call
      renderDetail(state, withPerms, results);
      return;
    }
  }

  // clamp cursor
  if (state.detailCursor >= navRows.length) state.detailCursor = Math.max(0, navRows.length - 1);

  // scroll
  const headerLines = 3;
  const footerLines = 2;
  const visibleRows = Math.max(1, rows - headerLines - footerLines);
  if (state.detailCursor < state.detailScroll) state.detailScroll = state.detailCursor;
  if (state.detailCursor >= state.detailScroll + visibleRows) state.detailScroll = state.detailCursor - visibleRows + 1;

  const visible = navRows.slice(state.detailScroll, state.detailScroll + visibleRows);

  const lines: string[] = [];
  lines.push(`  ${CYAN}${BOLD}${project.shortName}${NC}  ${DIM}(${project.totalCount} permissions)${NC}`);
  lines.push('');
  for (let i = 0; i < visible.length; i++) {
    const globalIdx = state.detailScroll + i;
    const isCursor = globalIdx === state.detailCursor;
    const row = visible[i];
    if (isCursor) {
      lines.push(row.line.replace(/^  /, `${CYAN}> `));
    } else {
      lines.push(row.line);
    }
  }
  lines.push('');
  lines.push(`  ${DIM}[↑↓] navigate  [Enter] expand/collapse  [Esc] back  [q] quit${NC}`);

  process.stdout.write(lines.join('\n') + '\n');
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function rpad(s: string | number, n: number): string {
  const str = String(s);
  return str.length >= n ? str : ' '.repeat(n - str.length) + str;
}
