import readline from 'node:readline';
import { RED, GREEN, YELLOW, CYAN, DIM, BOLD, NC } from './colors.js';
import { FileEntry } from './aggregator.js';
import { ScanResult, scanFile, removePerm, addPermToGlobal, findDuplicates } from './scanner.js';
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

interface SearchHit {
  projectName: string;
  projectIdx: number;
  perm: string;
  rawPerm: string;
  filePath: string;
  isHeader: boolean;
}

interface TuiState {
  view: 'list' | 'detail' | 'search';
  cursor: number;
  scrollOffset: number;
  selectedProject: number;
  detailCursor: number;
  detailScroll: number;
  expanded: Set<string>;
  showInfo: boolean;
  confirmDelete?: { perm: string; rawPerm: string; filePath: string };
  confirmGlobal?: { perm: string; rawPerm: string };
  flash?: string;
  searchActive: boolean;
  searchQuery: string;
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
  const infoPart = info ? ` ${info} ` : '';
  const maxTitle = inner - infoPart.length - 2; // 2 for spaces around title
  let truncTitle = title;
  if (visLen(truncTitle) > maxTitle) {
    // strip ANSI, truncate, re-wrap won't work cleanly — truncate the raw string
    const plain = truncTitle.replace(/\x1b\[[0-9;]*m/g, '');
    truncTitle = plain.slice(0, maxTitle - 1) + '…';
  }
  const titlePart = ` ${truncTitle} `;
  const fill = Math.max(0, inner - visLen(titlePart) - infoPart.length);
  return `${DIM}┌${titlePart}${'─'.repeat(fill)}${infoPart}┐${NC}`;
}

function boxBottom(hint: string, width: number): string {
  const inner = width - 2;
  const hintPart = ` ${hint} `;
  const fill = Math.max(0, inner - visLen(hintPart));
  return `${DIM}└${'─'.repeat(fill)}${hintPart}┘${NC}`;
}

function boxBottom2(line1: string, line2: string, width: number): string {
  const inner = width - 2;
  const hintPart = ` ${line1} `;
  const fill = Math.max(0, inner - visLen(hintPart));
  const top = `${DIM}│${NC}${' '.repeat(fill)}${hintPart}${DIM}│${NC}`;
  return top + '\n' + boxBottom(line2, width);
}

function boxSep(width: number): string {
  return `${DIM}├${'─'.repeat(width - 2)}┤${NC}`;
}


function refreshProject(results: ScanResult[], withPerms: FileEntry[], idx: number, filePath: string): void {
  const ri = results.findIndex((r) => r.path === filePath);
  if (ri >= 0) {
    const updated = scanFile(filePath);
    if (updated) {
      results[ri] = updated;
      const entry = withPerms[idx];
      entry.totalCount = updated.totalCount;
      entry.denyCount = updated.denyCount;
      entry.askCount = updated.askCount;
      entry.groups = new Map();
      for (const g of updated.groups) entry.groups.set(g.category, g.items.length);
    }
  }
}

function buildDupMap(results: ScanResult[]): Map<string, { exact: number; global: number }> {
  const globalResult = results.find((r) => r.isGlobal);
  const globalPerms = globalResult ? globalResult.permissions : [];
  const map = new Map<string, { exact: number; global: number }>();
  for (const r of results) {
    if (r.isGlobal) continue;
    const dup = findDuplicates(r.path, globalPerms);
    const total = dup.exact.length + dup.globalDup.length;
    if (total > 0) map.set(r.display, { exact: dup.exact.length, global: dup.globalDup.length });
  }
  return map;
}

function getGlobalPerms(results: ScanResult[]): string[] {
  const globalResult = results.find((r) => r.isGlobal);
  return globalResult ? globalResult.permissions : [];
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
    const depMap = buildDeprecatedMap(results);
    let dupMap = buildDupMap(results);

    if (withPerms.length === 0) {
      console.log(`\n  ${GREEN}No projects with permissions found.${NC}\n`);
      resolve();
      return;
    }

    const state: TuiState = { view: 'list', cursor: 0, scrollOffset: 0, selectedProject: 0, detailCursor: 0, detailScroll: 0, expanded: new Set(), showInfo: false, searchActive: false, searchQuery: '' };

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
      process.stdout.write('\x1b[2J\x1b[H');
      process.stdout.write(state.searchActive ? '\x1b[?25h' : '\x1b[?25l');
      if (state.view === 'search') renderSearch(state, withPerms, results);
      else if (state.view === 'list') renderList(state, withPerms, emptyCount, riskMap, depMap, dupMap);
      else renderDetail(state, withPerms, results, dupMap);
    };

    const onKey = (_str: string | undefined, key: readline.Key) => {
      if (!key) return;

      // Search typing mode (active in search view)
      if (state.searchActive) {
        if (key.name === 'escape') {
          state.searchActive = false;
          state.searchQuery = '';
          state.view = 'list';
          state.cursor = 0;
          state.scrollOffset = 0;
        } else if (key.name === 'return') {
          // Navigate to selected hit's project
          const hits = buildSearchHits(state.searchQuery, withPerms, results);
          const hit = hits[state.cursor];
          if (hit && !hit.isHeader) {
            state.searchActive = false;
            state.selectedProject = hit.projectIdx;
            state.detailCursor = 0;
            state.detailScroll = 0;
            state.expanded = new Set();
            state.searchQuery = '';
            state.view = 'detail';
          }
        } else if (key.name === 'backspace') {
          state.searchQuery = state.searchQuery.slice(0, -1);
          state.cursor = 0;
          state.scrollOffset = 0;
        } else if (key.name === 'up' || key.name === 'down') {
          const hits = buildSearchHits(state.searchQuery, withPerms, results);
          if (key.name === 'up') {
            do { state.cursor = Math.max(0, state.cursor - 1); }
            while (state.cursor > 0 && hits[state.cursor]?.isHeader);
          } else {
            do { state.cursor = Math.min(hits.length - 1, state.cursor + 1); }
            while (state.cursor < hits.length - 1 && hits[state.cursor]?.isHeader);
          }
        } else if (_str && _str.length === 1 && !key.ctrl && !key.meta) {
          state.searchQuery += _str;
          state.cursor = 0;
          state.scrollOffset = 0;
        }
        render();
        return;
      }

      if (key.name === 'q' || (key.name === 'c' && key.ctrl)) { cleanup(); console.log(''); resolve(); return; }

      // `/` activates search from list or search view
      if (_str === '/' && (state.view === 'list' || state.view === 'search') && !state.confirmDelete && !state.confirmGlobal) {
        state.searchActive = true;
        state.searchQuery = '';
        state.view = 'search';
        state.cursor = 0;
        state.scrollOffset = 0;
        render();
        return;
      }

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
      } else if (state.view === 'search') {
        const hits = buildSearchHits(state.searchQuery, withPerms, results);
        if (key.name === 'escape') {
          state.view = 'list';
          state.cursor = 0;
          state.scrollOffset = 0;
          state.searchQuery = '';
        } else if (key.name === 'up') {
          do { state.cursor = Math.max(0, state.cursor - 1); }
          while (state.cursor > 0 && hits[state.cursor]?.isHeader);
        } else if (key.name === 'down') {
          do { state.cursor = Math.min(hits.length - 1, state.cursor + 1); }
          while (state.cursor < hits.length - 1 && hits[state.cursor]?.isHeader);
        } else if (key.name === 'return') {
          const hit = hits[state.cursor];
          if (hit && !hit.isHeader) {
            state.selectedProject = hit.projectIdx;
            state.detailCursor = 0;
            state.detailScroll = 0;
            state.expanded = new Set();
            state.searchQuery = '';
            state.view = 'detail';
          }
        }
      } else {
        // detail view
        if (state.confirmDelete) {
          if (key.name === 'y') {
            const { rawPerm, filePath } = state.confirmDelete;
            if (removePerm(filePath, rawPerm)) {
              refreshProject(results, withPerms, state.selectedProject, filePath);
              dupMap = buildDupMap(results);
              state.flash = `${GREEN}✔ Deleted${NC}`;
            }
            state.confirmDelete = undefined;
          } else {
            state.confirmDelete = undefined;
          }
        } else if (state.confirmGlobal) {
          if (key.name === 'y') {
            if (addPermToGlobal(state.confirmGlobal.rawPerm)) {
              // Refresh global scan result so dupMap picks up new global perm
              const globalIdx = results.findIndex((r) => r.isGlobal);
              if (globalIdx >= 0) {
                const updated = scanFile(results[globalIdx].path);
                if (updated) results[globalIdx] = updated;
              }
              dupMap = buildDupMap(results);
              state.flash = `${GREEN}✔ Added to global${NC}`;
            } else {
              state.flash = `${DIM}· Already in global${NC}`;
            }
          }
          state.confirmGlobal = undefined;
        } else if (key.name === 'escape' || key.name === 'backspace') {
          state.view = 'list';
          state.detailCursor = 0;
          state.detailScroll = 0;
          state.searchQuery = '';
        } else if (key.name === 'up') {
          state.detailCursor = Math.max(0, state.detailCursor - 1);
        } else if (key.name === 'down') {
          state.detailCursor++;
        } else if (key.name === 'return') {
          (state as any)._toggle = true;
        } else if (key.name === 'i') {
          state.showInfo = !state.showInfo;
        } else if (key.name === 'd') {
          (state as any)._delete = true;
        } else if (key.name === 'g') {
          (state as any)._global = true;
        } else if (_str === '/' && !state.confirmDelete && !state.confirmGlobal) {
          state.searchActive = true;
          state.searchQuery = '';
          state.view = 'search';
          state.cursor = 0;
          state.scrollOffset = 0;
        }
      }

      render();
    };

    process.stdin.on('keypress', onKey);
    render();
  });
}

function buildDeprecatedMap(results: ScanResult[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of results) {
    let count = 0;
    for (const p of r.permissions) {
      if (p.includes(':*')) count++;
    }
    if (count > 0) map.set(r.display, count);
  }
  return map;
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

function renderList(state: TuiState, withPerms: FileEntry[], emptyCount: number, riskMap: Map<string, { critical: number; high: number }>, depMap: Map<string, number>, dupMap: Map<string, { exact: number; global: number }>): void {
  const rows = process.stdout.rows || 24;
  const cols = process.stdout.columns || 80;

  const cats = ['Bash', 'MCP', 'Tools'];
  const catsPresent = cats.filter((c) => withPerms.some((r) => r.groups.has(c)));

  const hasRisk = [...riskMap.values()].some((v) => v.critical > 0 || v.high > 0);
  const hasDep = depMap.size > 0;
  const hasDup = dupMap.size > 0;
  const riskColWidth = hasRisk ? 3 : 0;
  const depColWidth = hasDep ? 3 : 0;
  const dupColWidth = hasDup ? 4 : 0;
  const catColWidth = catsPresent.length * 7;
  const typeColWidth = 7;
  const maxName = Math.max(...withPerms.map((r) => r.shortName.length), 7);
  const nameColWidth = Math.min(maxName + typeColWidth, 35);
  const nameWidth = nameColWidth - typeColWidth;
  const contentWidth = 2 + nameColWidth + 2 + catColWidth + 2 + 5 + (hasRisk ? riskColWidth : 0) + (hasDep ? depColWidth : 0) + (hasDup ? dupColWidth : 0);
  const w = Math.min(cols, contentWidth + 4);

  const hasGlobalSep = withPerms.some((r) => r.isGlobal) && withPerms.some((r) => !r.isGlobal);
  const hasLegend = hasRisk || hasDep || hasDup;
  const chrome = 5 + (hasGlobalSep ? 1 : 0) + (emptyCount > 0 ? 1 : 0) + (hasLegend ? 1 : 0);
  const visibleRows = Math.min(25, Math.max(1, rows - chrome));

  if (state.cursor < state.scrollOffset) state.scrollOffset = state.cursor;
  if (state.cursor >= state.scrollOffset + visibleRows) state.scrollOffset = state.cursor - visibleRows + 1;

  const scrollInfo = withPerms.length > visibleRows ? `${state.cursor + 1}/${withPerms.length}` : '';
  const lines: string[] = [];

  lines.push(boxTop('ccperm', scrollInfo, w));
  const riskHeader = hasRisk ? ` ${rpad('!', 2)}` : '';
  const depHeader = hasDep ? ` ${rpad('†', 2)}` : '';
  const dupHeader = hasDup ? ` ${rpad('G', 3)}` : '';
  lines.push(boxLine(`${DIM}  ${pad('PROJECT', nameColWidth)}  ${catsPresent.map((c) => rpad(c, 5)).join('  ')}  ${rpad('TOTAL', 5)}${riskHeader}${depHeader}${dupHeader}${NC}`, w));
  lines.push(boxSep(w));

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
    let depCol = '';
    if (hasDep) {
      const dep = depMap.get(r.display) || 0;
      if (dep > 0) depCol = ` ${DIM}${rpad(dep, 2)}${NC}`;
      else depCol = ` ${DIM}${rpad('·', 2)}${NC}`;
    }
    let dupCol = '';
    if (hasDup) {
      const dup = dupMap.get(r.display);
      if (dup && dup.global > 0) {
        dupCol = ` ${YELLOW}${rpad(dup.global, 3)}${NC}`;
      } else {
        dupCol = ` ${DIM}${rpad('·', 3)}${NC}`;
      }
    }
    lines.push(boxLine(`${nameCol}  ${catCols}  ${totalCol}${riskCol}${depCol}${dupCol}`, w));

    // separator after global section
    if (r.isGlobal && i + 1 < withPerms.length && !withPerms[i + 1].isGlobal) {
      lines.push(boxSep(w));
    }
  }

  if (emptyCount > 0) {
    lines.push(boxLine(`${DIM}+ ${emptyCount} projects with no permissions${NC}`, w));
  }

  const legendParts: string[] = [];
  if (hasRisk) legendParts.push(`${RED}!${NC} risk`);
  if (hasDep) legendParts.push(`${DIM}†${NC} deprecated`);
  if (hasDup) legendParts.push(`${YELLOW}G${NC} in global`);
  const hint = '[↑↓] navigate  [Enter] detail  [/] search  [q] quit';
  if (legendParts.length > 0) {
    const legendStr = legendParts.join('  ');
    lines.push(boxBottom2(legendStr, hint, w));
  } else {
    lines.push(boxBottom(hint, w));
  }

  process.stdout.write(lines.join('\n') + '\n');
}

function buildSearchHits(query: string, withPerms: FileEntry[], results: ScanResult[]): SearchHit[] {
  if (!query) return [];
  const q = query.toLowerCase();
  const hits: SearchHit[] = [];
  for (let pi = 0; pi < withPerms.length; pi++) {
    const entry = withPerms[pi];
    const r = results.find((r) => r.display === entry.display);
    if (!r) continue;
    const matched = r.permissions.filter((p) => p.toLowerCase().includes(q));
    if (matched.length === 0) continue;
    hits.push({ projectName: entry.shortName, projectIdx: pi, perm: '', rawPerm: '', filePath: r.path, isHeader: true });
    for (const p of matched) {
      hits.push({ projectName: entry.shortName, projectIdx: pi, perm: p, rawPerm: p, filePath: r.path, isHeader: false });
    }
  }
  return hits;
}

function renderSearch(state: TuiState, withPerms: FileEntry[], results: ScanResult[]): void {
  const rows = process.stdout.rows || 24;
  const cols = process.stdout.columns || 80;
  const w = Math.min(cols, 82);

  const hits = buildSearchHits(state.searchQuery, withPerms, results);
  const permCount = hits.filter((h) => !h.isHeader).length;
  if (state.cursor >= hits.length) state.cursor = Math.max(0, hits.length - 1);
  // Skip header rows when navigating
  if (hits[state.cursor]?.isHeader && state.cursor + 1 < hits.length) state.cursor++;

  const chrome = 3; // top + bottom + search bar
  const visibleRows = Math.max(1, rows - chrome);
  if (state.cursor < state.scrollOffset) state.scrollOffset = state.cursor;
  if (state.cursor >= state.scrollOffset + visibleRows) state.scrollOffset = state.cursor - visibleRows + 1;

  const lines: string[] = [];
  const scrollInfo = hits.length > visibleRows ? `${state.cursor + 1}/${hits.length}` : '';
  lines.push(boxTop(`search: ${state.searchQuery}  ${permCount} permissions`, scrollInfo, w));

  const end = Math.min(state.scrollOffset + visibleRows, hits.length);
  for (let i = state.scrollOffset; i < end; i++) {
    const hit = hits[i];
    const isCursor = i === state.cursor;
    if (hit.isHeader) {
      const tag = withPerms[hit.projectIdx]?.isGlobal ? 'global' : withPerms[hit.projectIdx]?.fileType || '';
      lines.push(boxLine(`${YELLOW}  ${hit.projectName}${NC} ${DIM}${tag}${NC}`, w));
    } else {
      const prefix = isCursor ? `${CYAN}▸ ` : '  ';
      const clean = cleanLabel(hit.perm);
      const maxLen = w - 8;
      const name = clean.length > maxLen ? clean.slice(0, maxLen - 1) + '…' : clean;
      lines.push(boxLine(`${prefix}  ${DIM}${name}${NC}`, w));
    }
  }

  if (hits.length === 0 && state.searchQuery) {
    lines.push(boxLine(`${DIM}  No matches${NC}`, w));
  }

  if (state.searchActive) {
    lines.push(boxBottom(`/ ${state.searchQuery}█ (${permCount} matches)`, w));
  } else {
    lines.push(boxBottom(`[↑↓] navigate  [Enter] go to project  [/] new search  [Esc] back`, w));
  }

  process.stdout.write(lines.join('\n') + '\n');
}

function renderDetail(state: TuiState, withPerms: FileEntry[], results: ScanResult[], dupMap: Map<string, { exact: number; global: number }>): void {
  const rows = process.stdout.rows || 24;
  const cols = process.stdout.columns || 80;
  const w = Math.min(cols, 82);
  const project = withPerms[state.selectedProject];
  if (!project) return;

  const fileResult = results.find((r) => r.display === project.display);
  if (!fileResult || fileResult.totalCount === 0) return;

  // Compute dup info for this file
  const globalPerms = getGlobalPerms(results);
  const dupInfo = project.isGlobal ? { exact: [], globalDup: [] } : findDuplicates(fileResult.path, globalPerms);
  const exactSet = new Set(dupInfo.exact);
  const globalDupSet = new Set(dupInfo.globalDup);

  // build navigable rows
  const allNavRows: { text: string; key?: string; perm?: string; rawPerm?: string; isDeny?: boolean }[] = [];
  for (const group of fileResult.groups) {
    const key = `${fileResult.path}:${group.category}`;
    const isOpen = state.expanded.has(key);
    const arrow = isOpen ? '▾' : '▸';
    allNavRows.push({ text: `${YELLOW}${arrow} ${group.category}${NC} ${DIM}(${group.items.length})${NC}`, key });
    if (isOpen) {
      for (const item of group.items) {
        const clean = cleanLabel(item.name);
        const rawPerm = fileResult.permissions.find((p) => p.includes(item.name)) || '';

        // Dup tag
        let dupTag = '';
        if (globalDupSet.has(rawPerm)) dupTag = ` ${YELLOW}(in global)${NC}`;
        else if (exactSet.has(rawPerm)) dupTag = ` ${DIM}(dup)${NC}`;

        if (state.showInfo) {
          const info = explain(group.category, item.name);
          const tag = severityTag(info.risk);
          const tagLen = info.risk.length + 2;
          const nameMax = Math.min(30, w - tagLen - 14);
          const name = clean.length > nameMax ? clean.slice(0, nameMax - 1) + '…' : clean;
          const desc = info.description ? `${DIM}${info.description}${NC}` : '';
          allNavRows.push({ text: `  ${pad(name, nameMax)} ${tag} ${desc}${dupTag}`, perm: item.name, rawPerm });
        } else {
          const dupTagVis = dupTag ? 10 : 0; // reserve space for tag
          const maxLen = w - 8 - dupTagVis;
          const name = clean.length > maxLen ? clean.slice(0, maxLen - 1) + '…' : clean;
          allNavRows.push({ text: `  ${DIM}${name}${NC}${dupTag}`, perm: item.name, rawPerm });
        }
      }
    }
  }

  // Deny section
  if (fileResult.denyCount > 0) {
    const denyKey = `${fileResult.path}:__deny__`;
    const denyOpen = state.expanded.has(denyKey);
    const denyArrow = denyOpen ? '▾' : '▸';
    allNavRows.push({ text: `${DIM}${denyArrow} Deny${NC} ${DIM}(${fileResult.denyCount})${NC}`, key: denyKey, isDeny: true });
    if (denyOpen) {
      for (const group of fileResult.denyGroups) {
        for (const item of group.items) {
          const clean = cleanLabel(item.name);
          const maxLen = w - 16;
          const name = clean.length > maxLen ? clean.slice(0, maxLen - 1) + '…' : clean;
          allNavRows.push({ text: `  ${DIM}DENY  ${name}${NC}`, isDeny: true });
        }
      }
    }
  }

  // Ask section
  if (fileResult.askCount > 0) {
    const askKey = `${fileResult.path}:__ask__`;
    const askOpen = state.expanded.has(askKey);
    const askArrow = askOpen ? '▾' : '▸';
    allNavRows.push({ text: `${YELLOW}${askArrow} Ask${NC} ${DIM}(${fileResult.askCount})${NC}`, key: askKey, isDeny: true });
    if (askOpen) {
      for (const group of fileResult.askGroups) {
        for (const item of group.items) {
          const clean = cleanLabel(item.name);
          const maxLen = w - 16;
          const name = clean.length > maxLen ? clean.slice(0, maxLen - 1) + '…' : clean;
          allNavRows.push({ text: `  ${DIM}ASK   ${name}${NC}`, isDeny: true });
        }
      }
    }
  }

  // AllowedTools section
  if (fileResult.allowedTools.length > 0) {
    const atKey = `${fileResult.path}:__allowedTools__`;
    const atOpen = state.expanded.has(atKey);
    const atArrow = atOpen ? '▾' : '▸';
    allNavRows.push({ text: `${CYAN}${atArrow} AllowedTools${NC} ${DIM}(${fileResult.allowedTools.length})${NC}`, key: atKey, isDeny: true });
    if (atOpen) {
      for (const t of fileResult.allowedTools) {
        const maxLen = w - 10;
        const name = t.length > maxLen ? t.slice(0, maxLen - 1) + '…' : t;
        allNavRows.push({ text: `  ${DIM}${name}${NC}`, isDeny: true });
      }
    }
  }

  // DeniedTools section
  if (fileResult.deniedTools.length > 0) {
    const dtKey = `${fileResult.path}:__deniedTools__`;
    const dtOpen = state.expanded.has(dtKey);
    const dtArrow = dtOpen ? '▾' : '▸';
    allNavRows.push({ text: `${RED}${dtArrow} DeniedTools${NC} ${DIM}(${fileResult.deniedTools.length})${NC}`, key: dtKey, isDeny: true });
    if (dtOpen) {
      for (const t of fileResult.deniedTools) {
        const maxLen = w - 10;
        const name = t.length > maxLen ? t.slice(0, maxLen - 1) + '…' : t;
        allNavRows.push({ text: `  ${DIM}${name}${NC}`, isDeny: true });
      }
    }
  }

  // AdditionalDirectories section
  if (fileResult.additionalDirectories.length > 0) {
    const adKey = `${fileResult.path}:__additionalDirs__`;
    const adOpen = state.expanded.has(adKey);
    const adArrow = adOpen ? '▾' : '▸';
    allNavRows.push({ text: `${DIM}${adArrow} AdditionalDirectories${NC} ${DIM}(${fileResult.additionalDirectories.length})${NC}`, key: adKey, isDeny: true });
    if (adOpen) {
      for (const d of fileResult.additionalDirectories) {
        const maxLen = w - 10;
        const name = d.length > maxLen ? d.slice(0, maxLen - 1) + '…' : d;
        allNavRows.push({ text: `  ${DIM}${name}${NC}`, isDeny: true });
      }
    }
  }

  const navRows = allNavRows;

  // handle toggle
  if ((state as any)._toggle) {
    delete (state as any)._toggle;
    const row = navRows[state.detailCursor];
    if (row?.key) {
      if (state.expanded.has(row.key)) state.expanded.delete(row.key);
      else state.expanded.add(row.key);
      renderDetail(state, withPerms, results, dupMap);
      return;
    }
  }

  // handle delete
  if ((state as any)._delete) {
    delete (state as any)._delete;
    const row = navRows[state.detailCursor];
    if (row?.isDeny) {
      state.flash = `${DIM}· Deny rules cannot be deleted${NC}`;
    } else if (row?.rawPerm) {
      state.confirmDelete = { perm: row.perm!, rawPerm: row.rawPerm, filePath: fileResult.path };
    }
  }

  // handle global copy
  if ((state as any)._global) {
    delete (state as any)._global;
    const row = navRows[state.detailCursor];
    if (row?.isDeny) {
      state.flash = `${DIM}· Deny rules cannot be copied${NC}`;
    } else if (row?.rawPerm && !project.isGlobal) {
      state.confirmGlobal = { perm: row.perm!, rawPerm: row.rawPerm };
    }
  }

  if (state.detailCursor >= navRows.length) state.detailCursor = Math.max(0, navRows.length - 1);

  // top(1) + bottom(2 for hint, or 1 for flash/confirm/search)
  const bottomChrome = (!state.flash && !state.confirmDelete && !state.confirmGlobal && !state.searchActive) ? 4 : 3;
  const visibleRows = Math.max(1, rows - bottomChrome);
  if (state.detailCursor < state.detailScroll) state.detailScroll = state.detailCursor;
  if (state.detailCursor >= state.detailScroll + visibleRows) state.detailScroll = state.detailCursor - visibleRows + 1;

  const visible = navRows.slice(state.detailScroll, state.detailScroll + visibleRows);

  const scrollInfo = navRows.length > visibleRows ? `${state.detailCursor + 1}/${navRows.length}` : '';
  const lines: string[] = [];
  const typeTag = project.fileType === 'global' ? 'global' : project.fileType;
  const dupCount = dupMap.get(project.display);
  const globalCount = dupCount?.global || 0;
  const dupSuffix = globalCount > 0 ? `  ${YELLOW}${globalCount} in global${NC}` : '';
  lines.push(boxTop(`${project.shortName} (${typeTag})  ${project.totalCount} permissions${dupSuffix}`, scrollInfo, w));

  for (let i = 0; i < visible.length; i++) {
    const globalIdx = state.detailScroll + i;
    const isCursor = globalIdx === state.detailCursor;
    const row = visible[i];
    const prefix = isCursor ? `${CYAN}▸ ` : '  ';
    lines.push(boxLine(`${prefix}${row.text}`, w));
  }

  if (state.flash) {
    lines.push(boxBottom(state.flash, w));
    state.flash = undefined;
  } else if (state.confirmDelete) {
    const name = cleanLabel(state.confirmDelete.perm);
    const truncName = name.length > 30 ? name.slice(0, 29) + '…' : name;
    lines.push(boxBottom(`${RED}Delete "${truncName}"? [y/N]${NC}`, w));
  } else if (state.confirmGlobal) {
    const name = cleanLabel(state.confirmGlobal.perm);
    const truncName = name.length > 30 ? name.slice(0, 29) + '…' : name;
    lines.push(boxBottom(`${CYAN}Copy "${truncName}" to global? [y/N]${NC}`, w));
  } else if (state.searchActive) {
    lines.push(boxBottom(`/ ${state.searchQuery}█ (${navRows.length} matches)`, w));
  } else {
    const infoHint = state.showInfo ? '[i] hide info' : '[i] info';
    const globalHint = project.isGlobal ? '' : '  [g] +global';
    lines.push(boxBottom2(
      `${DIM}[↑↓] navigate  [Enter] expand  ${infoHint}  [d] delete${globalHint}${NC}`,
      `[/] search  [Esc] back  [q] quit`,
      w,
    ));
  }

  process.stdout.write(lines.join('\n') + '\n');
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function rpad(s: string | number, n: number): string {
  const str = String(s);
  return str.length >= n ? str : ' '.repeat(n - str.length) + str;
}
