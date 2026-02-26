import readline from 'node:readline';
import { RED, GREEN, YELLOW, CYAN, DIM, BOLD, NC } from './colors.js';
import { FileEntry } from './aggregator.js';
import { ScanResult } from './scanner.js';
import { explain, Severity } from './explain.js';

function severityTag(s: Severity): string {
  const labels: Record<Severity, string> = {
    critical: `${RED}CRITICAL${NC}`,
    high: `${YELLOW}HIGH${NC}    `,
    medium: `${DIM}MEDIUM${NC}  `,
    low: `${DIM}LOW${NC}     `,
  };
  return labels[s];
}

// Clean up messy bash permission labels for display
function cleanLabel(label: string): string {
  let s = label;
  // Strip __NEW_LINE_hash__ prefix
  s = s.replace(/^__NEW_LINE_[a-f0-9]+__\s*/, '');
  // Truncate heredoc content: "python3 << 'EOF'\nimport..." → "python3 (heredoc)"
  if (s.includes('<<')) s = s.replace(/\s*<<\s*['"]?\w+['"]?.*$/, ' (heredoc)');
  // Truncate inline scripts with \n
  if (s.includes('\\n')) s = s.replace(/\\n.*$/, '…');
  // Show deprecated :* as-is (don't normalize to space)
  return s;
}

interface TuiState {
  view: 'list' | 'detail';
  cursor: number;
  scrollOffset: number;
  selectedProject: number;
  detailCursor: number;
  detailScroll: number;
  expanded: Set<string>;
  showInfo: boolean;
}

// strip ANSI escape codes for visible length
function visLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

function boxLine(text: string, width: number): string {
  const vis = visLen(text);
  const padRight = Math.max(0, width - vis - 3);
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
  merged: FileEntry[],
  results: ScanResult[],
): Promise<void> {
  return new Promise((resolve) => {
    const globals = merged.filter((r) => r.isGlobal);
    const projects = merged.filter((r) => r.totalCount > 0 && !r.isGlobal).sort((a, b) => b.totalCount - a.totalCount);
    const withPerms = [...globals, ...projects];
    const emptyCount = merged.filter((r) => r.totalCount === 0 && !r.isGlobal).length;
    const riskMap = buildRiskMap(results);

    if (withPerms.length === 0) {
      console.log(`\n  ${GREEN}No projects with permissions found.${NC}\n`);
      resolve();
      return;
    }

    const state: TuiState = { view: 'list', cursor: 0, scrollOffset: 0, selectedProject: 0, detailCursor: 0, detailScroll: 0, expanded: new Set(), showInfo: false };

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
      if (state.view === 'list') renderList(state, withPerms, emptyCount, riskMap);
      else renderDetail(state, withPerms, results);
    };

    const onKey = (_str: string | undefined, key: readline.Key) => {
      if (!key) return;

      if (key.name === 'q' || (key.name === 'c' && key.ctrl)) { cleanup(); console.log(''); resolve(); return; }

      if (state.view === 'list') {
        if (key.name === 'up') state.cursor = Math.max(0, state.cursor - 1);
        else if (key.name === 'down') state.cursor = Math.min(withPerms.length - 1, state.cursor + 1);
        else if (key.name === 'return' && withPerms[state.cursor]?.totalCount > 0) {
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
        } else if (key.name === 'i') {
          state.showInfo = !state.showInfo;
        }
      }

      render();
    };

    process.stdin.on('keypress', onKey);
    render();
  });
}

function buildRiskMap(results: ScanResult[]): Map<string, { critical: number; high: number }> {
  const map = new Map<string, { critical: number; high: number }>();
  for (const r of results) {
    let crit = 0, hi = 0;
    for (const g of r.groups) {
      for (const item of g.items) {
        const info = explain(g.category, item.name);
        if (info.risk === 'critical') crit++;
        else if (info.risk === 'high') hi++;
      }
    }
    map.set(r.display, { critical: crit, high: hi });
  }
  return map;
}

function renderList(state: TuiState, withPerms: FileEntry[], emptyCount: number, riskMap: Map<string, { critical: number; high: number }>): void {
  const rows = process.stdout.rows || 24;
  const cols = process.stdout.columns || 80;

  const cats = ['Bash', 'MCP', 'Tools'];
  const catsPresent = cats.filter((c) => withPerms.some((r) => r.groups.has(c)));

  const hasRisk = [...riskMap.values()].some((v) => v.critical > 0 || v.high > 0);
  const riskColWidth = hasRisk ? 3 : 0;
  const catColWidth = catsPresent.length * 7;
  const typeColWidth = 7;
  const maxName = Math.max(...withPerms.map((r) => r.shortName.length), 7);
  const nameColWidth = Math.min(maxName + typeColWidth, 35);
  const nameWidth = nameColWidth - typeColWidth;
  // content: marker(2) + nameCol + gap(2) + catCols + gap(2) + total(5) + gap(1) + riskCol
  const contentWidth = 2 + nameColWidth + 2 + catColWidth + 2 + 5 + (hasRisk ? 1 + riskColWidth : 0);
  const w = Math.min(cols, contentWidth + 4);
  const inner = w - 4;

  const hasGlobalSep = withPerms.some((r) => r.isGlobal) && withPerms.some((r) => !r.isGlobal);
  // box takes: top(1) + header(2) + sep(1) + content + globalSep?(1) + emptyLine?(1) + bottom(1)
  const chrome = 5 + (hasGlobalSep ? 1 : 0) + (emptyCount > 0 ? 1 : 0);
  const visibleRows = Math.min(25, Math.max(1, rows - chrome));

  if (state.cursor < state.scrollOffset) state.scrollOffset = state.cursor;
  if (state.cursor >= state.scrollOffset + visibleRows) state.scrollOffset = state.cursor - visibleRows + 1;

  const scrollInfo = withPerms.length > visibleRows ? `${state.cursor + 1}/${withPerms.length}` : '';
  const lines: string[] = [];

  lines.push(boxTop('ccperm', scrollInfo, w));
  const riskHeader = hasRisk ? ` ${DIM}⚠${NC}` : '';
  lines.push(boxLine(`${DIM}${pad('PROJECT', nameColWidth)}  ${catsPresent.map((c) => rpad(c, 5)).join('  ')}  TOTAL${NC}${riskHeader}`, w));
  lines.push(boxSep(w));

  const globalCount = withPerms.filter((r) => r.isGlobal).length;
  const end = Math.min(state.scrollOffset + visibleRows, withPerms.length);
  for (let i = state.scrollOffset; i < end; i++) {
    const r = withPerms[i];
    const isCursor = i === state.cursor;
    const truncName = r.shortName.length > nameWidth ? r.shortName.slice(0, nameWidth - 1) + '…' : r.shortName;
    const typeTag = r.isGlobal ? pad('', 7) : `${DIM} ${pad(r.fileType, 6)}${NC}`;

    const marker = isCursor ? `${CYAN}▸ ` : '  ';
    const nameStyle = isCursor ? `${BOLD}` : '';
    const nameCol = `${marker}${nameStyle}${pad(truncName, nameWidth)}${NC}${typeTag}`;

    const catCols = catsPresent.map((c) => {
      const count = r.groups.get(c) || 0;
      if (count > 0) return isCursor ? `${BOLD}${rpad(count, 5)}${NC}` : rpad(count, 5);
      return `${DIM}${rpad('·', 5)}${NC}`;
    }).join('  ');

    const totalCol = isCursor ? `${BOLD}${rpad(r.totalCount, 5)}${NC}` : rpad(r.totalCount, 5);
    let riskCol = '';
    if (hasRisk) {
      const risk = riskMap.get(r.display) || { critical: 0, high: 0 };
      if (risk.critical > 0) riskCol = ` ${RED}${rpad(risk.critical, 2)}${NC}`;
      else if (risk.high > 0) riskCol = ` ${YELLOW}${rpad(risk.high, 2)}${NC}`;
      else riskCol = ` ${DIM}${rpad('·', 2)}${NC}`;
    }
    lines.push(boxLine(`${nameCol}  ${catCols}  ${totalCol}${riskCol}`, w));

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

function renderDetail(state: TuiState, withPerms: FileEntry[], results: ScanResult[]): void {
  const rows = process.stdout.rows || 24;
  const cols = process.stdout.columns || 80;
  const w = Math.min(cols, 82);
  const project = withPerms[state.selectedProject];
  if (!project) return;

  const fileResult = results.find((r) => r.display === project.display);
  if (!fileResult || fileResult.totalCount === 0) return;

  // build navigable rows
  const navRows: { text: string; key?: string; perm?: string }[] = [];
  for (const group of fileResult.groups) {
    const key = `${fileResult.path}:${group.category}`;
    const isOpen = state.expanded.has(key);
    const arrow = isOpen ? '▾' : '▸';
    navRows.push({ text: `${YELLOW}${arrow} ${group.category}${NC} ${DIM}(${group.items.length})${NC}`, key });
    if (isOpen) {
      for (const item of group.items) {
        const clean = cleanLabel(item.name);
        if (state.showInfo) {
          const info = explain(group.category, item.name);
          const tag = severityTag(info.risk);
          const tagLen = info.risk.length + 2; // tag visual width (e.g. "CRITICAL" + 2 spaces)
          const nameMax = Math.min(30, w - tagLen - 14);
          const name = clean.length > nameMax ? clean.slice(0, nameMax - 1) + '…' : clean;
          const desc = info.description ? `${DIM}${info.description}${NC}` : '';
          navRows.push({ text: `  ${pad(name, nameMax)} ${tag} ${desc}`, perm: item.name });
        } else {
          const maxLen = w - 8;
          const name = clean.length > maxLen ? clean.slice(0, maxLen - 1) + '…' : clean;
          navRows.push({ text: `  ${DIM}${name}${NC}`, perm: item.name });
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
  const typeTag = project.fileType === 'global' ? 'global' : project.fileType;
  lines.push(boxTop(`${project.shortName} (${typeTag})  ${project.totalCount} permissions`, scrollInfo, w));

  for (let i = 0; i < visible.length; i++) {
    const globalIdx = state.detailScroll + i;
    const isCursor = globalIdx === state.detailCursor;
    const row = visible[i];
    const prefix = isCursor ? `${CYAN}▸ ` : '  ';
    lines.push(boxLine(`${prefix}${row.text}`, w));
  }

  const infoHint = state.showInfo ? '[i] hide info' : '[i] info';
  lines.push(boxBottom(`[↑↓] navigate  [Enter] expand  ${infoHint}  [Esc] back  [q] quit`, w));

  process.stdout.write(lines.join('\n') + '\n');
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function rpad(s: string | number, n: number): string {
  const str = String(s);
  return str.length >= n ? str : ' '.repeat(n - str.length) + str;
}
