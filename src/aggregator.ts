import { ScanResult } from './scanner.js';

export interface MergedResult {
  display: string;
  shortName: string;
  totalCount: number;
  groups: Map<string, number>;
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

export function mergeByProject(results: ScanResult[]): MergedResult[] {
  const map = new Map<string, MergedResult>();
  for (const r of results) {
    const dir = projectDir(r.display);
    let merged = map.get(dir);
    if (!merged) {
      merged = { display: r.display, shortName: shortPath(r.display), totalCount: 0, groups: new Map() };
      map.set(dir, merged);
    }
    merged.totalCount += r.totalCount;
    for (const g of r.groups) {
      merged.groups.set(g.category, (merged.groups.get(g.category) || 0) + g.items.length);
    }
  }
  return [...map.values()];
}

export function summarize(results: ScanResult[]): AuditSummary {
  const merged = mergeByProject(results);
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
    totalProjects: merged.length,
    projectsWithPerms,
    projectsEmpty,
    totalPerms,
    categoryTotals,
  };
}
