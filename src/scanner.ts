import fs from 'node:fs';
import os from 'node:os';
import { execFile } from 'node:child_process';

export interface PermGroup {
  category: string;
  items: { name: string }[];
}

export interface ScanResult {
  path: string;
  display: string;
  permissions: string[];
  groups: PermGroup[];
  totalCount: number;
}

const PERM_RE = /"(Bash|Write|Edit|Read|Glob|Grep|WebSearch|WebFetch|mcp_)[^"]*"/g;
const DEPRECATED_RE = /:\*\)|:\*"/g;

export function countDeprecated(results: ScanResult[]): { path: string; count: number }[] {
  const out: { path: string; count: number }[] = [];
  for (const r of results) {
    let content: string;
    try { content = fs.readFileSync(r.path, 'utf8'); } catch { continue; }
    const m = content.match(DEPRECATED_RE);
    if (m) out.push({ path: r.path, count: m.length });
  }
  return out;
}

function isWritable(f: string): boolean {
  try { fs.accessSync(f, fs.constants.W_OK); return true; } catch { return false; }
}

export function findSettingsFiles(searchDir: string, onProgress?: (count: number) => void): Promise<string[]> {
  const prune = ['node_modules', '.git', '.cache', '.local', '.npm', '.nvm', '.bun',
    'snap', '.vscode', '.docker', '.cargo', '.rustup', 'go', '.gradle', '.m2',
    'Library', '.Trash', 'Pictures', 'Music', 'Videos', 'Downloads'];
  const pruneArgs = prune.flatMap((d) => ['-name', d, '-o']).slice(0, -1);

  return new Promise((resolve) => {
    const results: string[] = [];
    let buf = '';
    const child = execFile('find', [
      searchDir,
      '(', ...pruneArgs, ')', '-prune',
      '-o', '-path', '*/.claude/settings*.json', '-type', 'f', '-print',
    ], { encoding: 'utf8', timeout: 15000 });

    child.stdout?.on('data', (chunk: string) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (line && isWritable(line)) results.push(line);
      }
      onProgress?.(results.length);
    });

    child.on('close', () => {
      if (buf && isWritable(buf)) results.push(buf);
      onProgress?.(results.length);
      resolve(results);
    });

    child.on('error', () => resolve(results));
  });
}

export function scanFile(filePath: string): ScanResult | null {
  const home = os.homedir();
  const display = filePath.startsWith(home) ? '~' + filePath.slice(home.length) : filePath;

  let content: string;
  try { content = fs.readFileSync(filePath, 'utf8'); } catch { return null; }

  const perms = [...new Set((content.match(PERM_RE) || []).map((s) => s.slice(1, -1)))].sort();

  const groups = groupPermissions(perms);
  const totalCount = perms.length;

  return { path: filePath, display, permissions: perms, groups, totalCount };
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
  const map = new Map<string, { name: string }[]>();
  for (const p of perms) {
    const { category, label } = categorize(p);
    if (!map.has(category)) map.set(category, []);
    map.get(category)!.push({ name: label });
  }
  const order = ['Bash', 'WebFetch', 'MCP', 'Tools', 'Other'];
  return order.filter((c) => map.has(c)).map((c) => ({ category: c, items: map.get(c)! }));
}
