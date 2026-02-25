import readline from 'node:readline';
import { GREEN, YELLOW, CYAN, DIM, BOLD, NC } from './colors.js';
import { MergedResult } from './aggregator.js';
import { ScanResult } from './scanner.js';

interface TuiState {
  view: 'list' | 'detail';
  cursor: number;
  scrollOffset: number;
  selectedProject: number;
  detailCursor: number;
  detailScroll: number;
  expanded: Set<string>;
}

// strip ANSI escape codes for visible length
function visLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

function boxLine(text: string, width: number): string {
  const vis = visLen(text);
  const padRight = Math.max(0, width - vis - 1);
  return `${DIM}│${NC} ${text}${' '.repeat(padRight)}${DIM}│${NC}`;
}

function boxTop(title: string, info: string, width: number): string {
  const inner = width - 2;
  const titlePart = ` ${title} `;
  const infoPart = info ? ` ${info} ` : '';
  const fill = Math.max(0, inner - titlePart.length - infoPart.length);
  return `${DIM}┌${titlePart}${'─'.repeat(fill)}${infoPart}┐${NC}`;
}

function boxBottom(hint: string, width: number): string {
  const inner = width - 2;
  const hintPart = ` ${hint} `;
  const fill = Math.max(0, inner - hintPart.length);
  return `${DIM}└${'─'.repeat(fill)}${hintPart}┘${NC}`;
}

function boxSep(width: number): string {
  return `${DIM}├${'─'.repeat(width - 2)}┤${NC}`;
}

export function startInteractive(
  merged: MergedResult[],
  results: ScanResult[],
): Promise<void> {
  return new Promise((resolve) => {
    const globals = merged.filter((r) => r.totalCount > 0 && r.isGlobal).sort((a, b) => b.totalCount - a.totalCount);
    const projects = merged.filter((r) => r.totalCount > 0 && !r.isGlobal).sort((a, b) => b.totalCount - a.totalCount);
    const withPerms = [...globals, ...projects];
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
      process.stdout.write('\x1b[?25h');
    };

    const onSigint = () => { cleanup(); process.exit(0); };
    process.on('SIGINT', onSigint);

    const render = () => {
      process.stdout.write('\x1b[2J\x1b[H\x1b[?25l');
      if (state.view === 'list') renderList(state, withPerms, emptyCount);
      else renderDetail(state, withPerms, results);
    };

    const onKey = (_str: string | undefined, key: readline.Key) => {
      if (!key) return;

      if (key.name === 'q') { cleanup(); console.log(''); resolve(); return; }

      if (state.view === 'list') {
        if (key.name === 'up') state.cursor = Math.max(0, state.cursor - 1);
        else if (key.name === 'down') state.cursor = Math.min(withPerms.length - 1, state.cursor + 1);
        else if (key.name === 'return') {
          state.selectedProject = state.cursor;
          state.detailCursor = 0;
          state.detailScroll = 0;
          state.expanded = new Set();
          state.view = 'detail';
        }
      } else {
        if (key.name === 'escape' || key.name === 'backspace') {
          state.view = 'list';
          state.detailCursor = 0;
          state.detailScroll = 0;
        } else if (key.name === 'up') {
          state.detailCursor = Math.max(0, state.detailCursor - 1);
        } else if (key.name === 'down') {
          state.detailCursor++;
        } else if (key.name === 'return') {
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
  const w = Math.min(cols, 82);
  const inner = w - 4; // box border + 1 space each side

  const cats = ['Bash', 'WebFetch', 'MCP', 'Tools'];
  const catsPresent = cats.filter((c) => withPerms.some((r) => r.groups.has(c)));

  const catColWidth = catsPresent.length * 7;
  const nameWidths = withPerms.map((r) => r.isGlobal ? r.shortName.length + 2 : r.shortName.length);
  const nameWidth = Math.min(Math.max(...nameWidths, 7), inner - catColWidth - 8);

  const hasGlobalSep = withPerms.some((r) => r.isGlobal) && withPerms.some((r) => !r.isGlobal);
  // box takes: top(1) + header(2) + sep(1) + content + globalSep?(1) + emptyLine?(1) + bottom(1)
  const chrome = 5 + (hasGlobalSep ? 1 : 0) + (emptyCount > 0 ? 1 : 0);
  const visibleRows = Math.min(25, Math.max(1, rows - chrome));

  if (state.cursor < state.scrollOffset) state.scrollOffset = state.cursor;
  if (state.cursor >= state.scrollOffset + visibleRows) state.scrollOffset = state.cursor - visibleRows + 1;

  const scrollInfo = withPerms.length > visibleRows ? `${state.cursor + 1}/${withPerms.length}` : '';
  const lines: string[] = [];

  lines.push(boxTop('ccperm', scrollInfo, w));
  lines.push(boxLine(`${DIM}${pad('PROJECT', nameWidth)}  ${catsPresent.map((c) => rpad(c, 5)).join('  ')}  TOTAL${NC}`, w));
  lines.push(boxSep(w));

  const globalCount = withPerms.filter((r) => r.isGlobal).length;
  const end = Math.min(state.scrollOffset + visibleRows, withPerms.length);
  for (let i = state.scrollOffset; i < end; i++) {
    const r = withPerms[i];
    const isCursor = i === state.cursor;
    const displayName = r.isGlobal ? `★ ${r.shortName}` : r.shortName;
    const truncName = displayName.length > nameWidth ? displayName.slice(0, nameWidth - 1) + '…' : displayName;

    const marker = isCursor ? `${CYAN}▸ ` : '  ';
    const nameStyle = isCursor ? `${BOLD}` : r.isGlobal ? `${YELLOW}` : `${DIM}`;
    const nameCol = `${marker}${nameStyle}${pad(truncName, nameWidth)}${NC}`;

    const catCols = catsPresent.map((c) => {
      const count = r.groups.get(c) || 0;
      if (count > 0) return isCursor ? `${BOLD}${rpad(count, 5)}${NC}` : rpad(count, 5);
      return `${DIM}${rpad('·', 5)}${NC}`;
    }).join('  ');

    const totalCol = isCursor ? `${BOLD}${rpad(r.totalCount, 5)}${NC}` : rpad(r.totalCount, 5);
    lines.push(boxLine(`${nameCol}  ${catCols}  ${totalCol}`, w));

    // separator after global section
    if (r.isGlobal && i + 1 < withPerms.length && !withPerms[i + 1].isGlobal) {
      lines.push(boxSep(w));
    }
  }

  if (emptyCount > 0) {
    lines.push(boxLine(`${DIM}+ ${emptyCount} projects with no permissions${NC}`, w));
  }

  lines.push(boxBottom('[↑↓] navigate  [Enter] detail  [q] quit', w));

  process.stdout.write(lines.join('\n') + '\n');
}

function renderDetail(state: TuiState, withPerms: MergedResult[], results: ScanResult[]): void {
  const rows = process.stdout.rows || 24;
  const cols = process.stdout.columns || 80;
  const w = Math.min(cols, 82);
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
  const navRows: { text: string; key?: string }[] = [];
  for (const result of projectResults) {
    if (result.totalCount === 0) continue;
    const fileName = result.display.replace(/.*\/\.claude\//, '');
    navRows.push({ text: `${CYAN}${fileName}${NC}  ${DIM}(${result.totalCount})${NC}` });
    for (const group of result.groups) {
      const key = `${result.path}:${group.category}`;
      const isOpen = state.expanded.has(key);
      const arrow = isOpen ? '▾' : '▸';
      navRows.push({ text: `  ${YELLOW}${arrow} ${group.category}${NC} ${DIM}(${group.items.length})${NC}`, key });
      if (isOpen) {
        const maxLen = w - 12;
        for (const item of group.items) {
          const name = item.name.length > maxLen ? item.name.slice(0, maxLen - 1) + '…' : item.name;
          navRows.push({ text: `    ${DIM}${name}${NC}` });
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
      renderDetail(state, withPerms, results);
      return;
    }
  }

  if (state.detailCursor >= navRows.length) state.detailCursor = Math.max(0, navRows.length - 1);

  // box chrome: top(1) + sep(1) + bottom(1) = 3
  const visibleRows = Math.max(1, rows - 3);
  if (state.detailCursor < state.detailScroll) state.detailScroll = state.detailCursor;
  if (state.detailCursor >= state.detailScroll + visibleRows) state.detailScroll = state.detailCursor - visibleRows + 1;

  const visible = navRows.slice(state.detailScroll, state.detailScroll + visibleRows);

  const scrollInfo = navRows.length > visibleRows ? `${state.detailCursor + 1}/${navRows.length}` : '';
  const lines: string[] = [];
  lines.push(boxTop(`${project.shortName}  (${project.totalCount})`, scrollInfo, w));

  for (let i = 0; i < visible.length; i++) {
    const globalIdx = state.detailScroll + i;
    const isCursor = globalIdx === state.detailCursor;
    const row = visible[i];
    const prefix = isCursor ? `${CYAN}▸ ` : '  ';
    lines.push(boxLine(`${prefix}${row.text}`, w));
  }

  lines.push(boxBottom('[↑↓] navigate  [Enter] expand  [Esc] back  [q] quit', w));

  process.stdout.write(lines.join('\n') + '\n');
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function rpad(s: string | number, n: number): string {
  const str = String(s);
  return str.length >= n ? str : ' '.repeat(n - str.length) + str;
}
