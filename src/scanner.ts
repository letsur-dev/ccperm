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
  isGlobal: boolean;
}

const PERM_RE = /"(Bash|Write|Edit|Read|Glob|Grep|WebSearch|WebFetch|mcp_)[^"]*"/g;
const DEPRECATED_RE = /:\*\)|:\*"/g;

const AUDIT_DIR = path.join(os.homedir(), '.ccperm', 'audit');

function writeAudit(action: string, filePath: string, perm: string, before: string[], after: string[]): void {
  try {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const entry = { action, file: filePath, perm, before, after, timestamp: new Date().toISOString() };
    fs.writeFileSync(path.join(AUDIT_DIR, `${ts}_${action}.json`), JSON.stringify(entry, null, 2) + '\n');
  } catch { /* audit is best-effort */ }
}

export function removePerm(filePath: string, rawPerm: string): boolean {
  let content: string;
  try { content = fs.readFileSync(filePath, 'utf8'); } catch { return false; }
  let json: any;
  try { json = JSON.parse(content); } catch { return false; }
  const allow: string[] = json?.permissions?.allow;
  if (!Array.isArray(allow)) return false;
  const idx = allow.indexOf(rawPerm);
  if (idx === -1) return false;
  const before = [...allow];
  allow.splice(idx, 1);
  fs.writeFileSync(filePath, JSON.stringify(json, null, 2) + '\n', 'utf8');
  writeAudit('DELETE', filePath, rawPerm, before, allow);
  return true;
}

export function addPermToGlobal(rawPerm: string): boolean {
  const globalPath = path.join(os.homedir(), '.claude', 'settings.json');
  let content: string;
  try { content = fs.readFileSync(globalPath, 'utf8'); } catch { content = '{}'; }
  let json: any;
  try { json = JSON.parse(content); } catch { return false; }
  if (!json.permissions) json.permissions = {};
  if (!Array.isArray(json.permissions.allow)) json.permissions.allow = [];
  const allow: string[] = json.permissions.allow;
  if (allow.includes(rawPerm)) return false; // already exists
  const before = [...allow];
  allow.push(rawPerm);
  fs.writeFileSync(globalPath, JSON.stringify(json, null, 2) + '\n', 'utf8');
  writeAudit('COPY_TO_GLOBAL', globalPath, rawPerm, before, allow);
  return true;
}

export interface DupInfo {
  exact: string[];   // duplicated within same file
  globalDup: string[]; // redundant with global
}

export function findDuplicates(filePath: string, globalPerms: string[]): DupInfo {
  let content: string;
  try { content = fs.readFileSync(filePath, 'utf8'); } catch { return { exact: [], globalDup: [] }; }
  let json: any;
  try { json = JSON.parse(content); } catch { return { exact: [], globalDup: [] }; }
  const allow: string[] = json?.permissions?.allow;
  if (!Array.isArray(allow)) return { exact: [], globalDup: [] };

  const exact: string[] = [];
  const seen = new Set<string>();
  for (const p of allow) {
    if (seen.has(p)) { if (!exact.includes(p)) exact.push(p); }
    else seen.add(p);
  }

  const globalSet = new Set(globalPerms);
  const globalDup = [...new Set(allow)].filter((p) => globalSet.has(p));

  return { exact, globalDup };
}


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
      return;
    }

    const subdirs: Promise<void>[] = [];

    for (const entry of entries) {
      const name = entry.name;

      if (name === '.claude' && entry.isDirectory()) {
        const claudeDir = path.join(dir, '.claude');
        let inner: string[];
        try { inner = await fs.promises.readdir(claudeDir); } catch { continue; }
        for (const f of inner) {
          if (f === 'settings.json' || f === 'settings.local.json') {
            const full = path.join(claudeDir, f);
            try {
              await fs.promises.access(full, fs.constants.W_OK);
              results.push(full);
              onProgress?.(results.length);
              if (debug) console.error(`  [debug] found: ${full}`);
            } catch { /* not writable */ }
          }
        }
        continue;
      }

      if (!entry.isDirectory()) continue;
      if (SKIP.has(name)) continue;
      if (name.startsWith('.') && name !== '.claude') continue;

      subdirs.push(walk(path.join(dir, name)));
    }

    await Promise.all(subdirs);
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
  const isGlobal = path.dirname(path.dirname(filePath)) === home;

  let content: string;
  try { content = fs.readFileSync(filePath, 'utf8'); } catch { return null; }

  const perms = [...new Set((content.match(PERM_RE) || []).map((s) => s.slice(1, -1)))].sort();

  const groups = groupPermissions(perms);
  const totalCount = perms.length;

  return { path: filePath, display, permissions: perms, groups, totalCount, isGlobal };
}

function categorize(perm: string): { category: string; label: string } {
  if (perm.startsWith('Bash')) {
    const m = perm.match(/^Bash\((.+)\)$/) || perm.match(/^Bash\((.+)/);
    return { category: 'Bash', label: m ? m[1] : perm };
  }
  if (perm.startsWith('mcp_') || perm.startsWith('mcp__')) {
    return { category: 'MCP', label: perm };
  }
  if (/^(Read|Write|Edit|Glob|Grep|WebSearch|WebFetch)/.test(perm)) {
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
  const order = ['Bash', 'MCP', 'Tools', 'Other'];
  return order.filter((c) => map.has(c)).map((c) => ({ category: c, items: map.get(c)! }));
}
