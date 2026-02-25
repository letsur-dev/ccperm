import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

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

const SKIP = new Set([
  'node_modules', '.git', '.cache', '.local', '.npm', '.nvm', '.bun',
  '.vscode', '.docker', '.cargo', '.rustup', 'go', '.gradle', '.m2',
  '.Trash', 'Pictures', 'Music', 'Videos', 'Downloads',
  'snap', '.snap',
  'Library', 'Applications', '.Spotlight-V100', '.fseventsd',
  'Movies', 'Photos', '.iCloud',
]);

export async function findSettingsFiles(
  searchDir: string,
  onProgress?: (count: number) => void,
  debug = false,
): Promise<string[]> {
  const results: string[] = [];
  const t0 = Date.now();

  async function walk(dir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return; // permission denied, etc.
    }

    for (const entry of entries) {
      const name = entry.name;

      if (name === '.claude' && entry.isDirectory()) {
        // found a .claude dir — check for settings files inside
        const claudeDir = path.join(dir, '.claude');
        let inner: string[];
        try { inner = await fs.promises.readdir(claudeDir); } catch { continue; }
        for (const f of inner) {
          if (f.startsWith('settings') && f.endsWith('.json')) {
            const full = path.join(claudeDir, f);
            try {
              await fs.promises.access(full, fs.constants.W_OK);
              results.push(full);
              onProgress?.(results.length);
              if (debug) console.error(`  [debug] found: ${full}`);
            } catch { /* not writable */ }
          }
        }
        continue; // don't recurse into .claude
      }

      if (!entry.isDirectory()) continue;
      if (SKIP.has(name)) continue;
      if (name.startsWith('.') && name !== '.claude') continue; // skip other hidden dirs

      await walk(path.join(dir, name));
    }
  }

  await walk(searchDir);

  if (debug) {
    console.error(`  [debug] scan completed in ${Date.now() - t0}ms`);
    console.error(`  [debug] found ${results.length} files`);
  }

  return results;
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
