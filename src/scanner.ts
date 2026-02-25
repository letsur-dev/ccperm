import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

export interface ScanResult {
  path: string;
  display: string;
  permissions: string[];
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

  return { path: filePath, display, permissions: perms, deprecatedCount };
}
