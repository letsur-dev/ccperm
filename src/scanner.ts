import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

export interface PermGroup {
  category: string;
  items: { name: string; deprecated: boolean }[];
}

export interface ScanResult {
  path: string;
  display: string;
  permissions: string[];
  groups: PermGroup[];
  totalCount: number;
  deprecatedCount: number;
}

const PERM_RE = /"(Bash|Write|Edit|Read|Glob|Grep|WebSearch|WebFetch|mcp_)[^"]*"/g;
const DEPRECATED_RE = /:\*\)|:\*"/g;
export const DEPRECATED_PERM_RE = /:\*$|:\*\)/;

export function findSettingsFiles(searchDir: string): string[] {
  let lines: string[];
  try {
    const out = execFileSync('find', [searchDir, '-path', '*/.claude/settings*.json', '-type', 'f'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    lines = out.trim().split('\n').filter(Boolean);
  } catch (e: any) {
    lines = (e.stdout || '').trim().split('\n').filter(Boolean);
  }
  return lines.filter((f) => {
    try { fs.accessSync(f, fs.constants.W_OK); return true; } catch { return false; }
  });
}

export function scanFile(filePath: string): ScanResult | null {
  const home = os.homedir();
  const display = filePath.startsWith(home) ? '~' + filePath.slice(home.length) : filePath;

  let content: string;
  try { content = fs.readFileSync(filePath, 'utf8'); } catch { return null; }

  const perms = [...new Set((content.match(PERM_RE) || []).map((s) => s.slice(1, -1)))].sort();
  const matches = content.match(DEPRECATED_RE);
  const deprecatedCount = matches ? matches.length : 0;

  const groups = groupPermissions(perms);
  const totalCount = perms.length;

  return { path: filePath, display, permissions: perms, groups, totalCount, deprecatedCount };
}

function categorize(perm: string): { category: string; label: string } {
  if (perm.startsWith('Bash')) {
    const m = perm.match(/^Bash\((.+)\)$/) || perm.match(/^Bash\((.+)/);
    return { category: 'Bash', label: m ? m[1] : perm };
  }
  if (perm.startsWith('WebFetch')) {
    const m = perm.match(/^WebFetch\(domain:(.+)\)$/);
    return { category: 'WebFetch', label: m ? m[1] : perm };
  }
  if (perm.startsWith('mcp_') || perm.startsWith('mcp__')) {
    return { category: 'MCP', label: perm };
  }
  if (/^(Read|Write|Edit|Glob|Grep|WebSearch)/.test(perm)) {
    return { category: 'Tools', label: perm };
  }
  return { category: 'Other', label: perm };
}

function groupPermissions(perms: string[]): PermGroup[] {
  const map = new Map<string, { name: string; deprecated: boolean }[]>();
  for (const p of perms) {
    const { category, label } = categorize(p);
    if (!map.has(category)) map.set(category, []);
    map.get(category)!.push({ name: label, deprecated: DEPRECATED_PERM_RE.test(p) });
  }
  const order = ['Bash', 'WebFetch', 'MCP', 'Tools', 'Other'];
  return order.filter((c) => map.has(c)).map((c) => ({ category: c, items: map.get(c)! }));
}
