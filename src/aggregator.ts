import { ScanResult } from './scanner.js';

export interface FileEntry {
  display: string;
  shortName: string;
  fileType: 'global' | 'shared' | 'local';
  totalCount: number;
  groups: Map<string, number>;
  isGlobal: boolean;
}

export interface AuditSummary {
  totalProjects: number;
  projectsWithPerms: number;
  projectsEmpty: number;
  totalPerms: number;
  categoryTotals: Map<string, number>;
}

export function shortPath(display: string): string {
  const m = display.match(/\/([^/]+)\/\.claude\//);
  return m ? m[1] : display;
}

export function projectDir(display: string): string {
  const idx = display.indexOf('/.claude/');
  return idx >= 0 ? display.slice(0, idx) : display;
}

export function toFileEntries(results: ScanResult[]): FileEntry[] {
  return results.map((r) => {
    const groups = new Map<string, number>();
    for (const g of r.groups) {
      groups.set(g.category, g.items.length);
    }
    const fileType = r.isGlobal ? 'global' as const : r.display.includes('settings.local.json') ? 'local' as const : 'shared' as const;
    const name = r.isGlobal ? 'GLOBAL' : shortPath(r.display);
    return { display: r.display, shortName: name, totalCount: r.totalCount, groups, isGlobal: r.isGlobal, fileType };
  });
}

export function summarize(results: ScanResult[]): AuditSummary {
  const dirs = new Set(results.map((r) => projectDir(r.display)));
  const categoryTotals = new Map<string, number>();

  for (const r of results) {
    for (const group of r.groups) {
      categoryTotals.set(group.category, (categoryTotals.get(group.category) || 0) + group.items.length);
    }
  }

  const projectsWithPerms = results.filter((r) => r.totalCount > 0).length;
  const projectsEmpty = results.filter((r) => r.totalCount === 0).length;
  const totalPerms = [...categoryTotals.values()].reduce((a, b) => a + b, 0);

  return {
    totalProjects: dirs.size,
    projectsWithPerms,
    projectsEmpty,
    totalPerms,
    categoryTotals,
  };
}
