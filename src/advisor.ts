import { ScanResult } from './scanner.js';
import { toFileEntries, projectDir } from './aggregator.js';
import { explain, Severity } from './explain.js';

interface Finding {
  severity: Severity;
  permission: string;
  description: string;
  domain: string;
  project: string;
  fileType: string;
}

function extractCmd(label: string): string {
  return label.replace(/__NEW_LINE_[a-f0-9]+__\s*/, '').replace(/[:]\*.*$/, '').replace(/\s\*.*$/, '').split(/[\s(]/)[0];
}

export function analyze(results: ScanResult[]): string {
  const entries = toFileEntries(results);
  const withPerms = entries.filter((e) => e.totalCount > 0);
  const lines: string[] = [];
  const dirs = new Set(results.map((r) => projectDir(r.display)));
  const totalPerms = results.reduce((sum, r) => sum + r.totalCount, 0);

  // Collect all findings with DCG-style severity
  const findings: Finding[] = [];
  for (const r of results) {
    const dir = projectDir(r.display).replace(/.*\//, '');
    const file = r.display.includes('settings.local.json') ? 'local' : 'shared';
    for (const g of r.groups) {
      for (const item of g.items) {
        const info = explain(g.category, item.name);
        findings.push({
          severity: info.risk,
          permission: item.name,
          description: info.description,
          domain: info.domain || '',
          project: dir,
          fileType: file,
        });
      }
    }
  }

  const critical = findings.filter((f) => f.severity === 'critical');
  const high = findings.filter((f) => f.severity === 'high');

  // Header
  lines.push(`# ccperm: Permission Audit`);
  lines.push(``);
  lines.push(`Scanned ${results.length} settings files across ${dirs.size} projects. Found ${totalPerms} total permissions.`);
  lines.push(``);

  // Severity summary
  const counts = { critical: critical.length, high: high.length, medium: findings.filter((f) => f.severity === 'medium').length, low: findings.filter((f) => f.severity === 'low').length };
  lines.push(`## Risk summary`);
  lines.push(`- CRITICAL: ${counts.critical}`);
  lines.push(`- HIGH: ${counts.high}`);
  lines.push(`- MEDIUM: ${counts.medium}`);
  lines.push(`- LOW: ${counts.low}`);
  lines.push(``);

  // Critical findings
  if (critical.length > 0) {
    lines.push(`## CRITICAL findings`);
    const seen = new Set<string>();
    for (const f of critical) {
      const key = `${f.project}:${f.permission}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const desc = f.description ? ` — ${f.description}` : '';
      const domain = f.domain ? ` [${f.domain}]` : '';
      lines.push(`- \`${f.permission}\` in ${f.project} (${f.fileType})${desc}${domain}`);
    }
    lines.push(``);
  }

  // High findings
  if (high.length > 0) {
    lines.push(`## HIGH findings`);
    const seen = new Set<string>();
    for (const f of high) {
      const key = `${f.project}:${f.permission}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const desc = f.description ? ` — ${f.description}` : '';
      const domain = f.domain ? ` [${f.domain}]` : '';
      lines.push(`- \`${f.permission}\` in ${f.project} (${f.fileType})${desc}${domain}`);
    }
    lines.push(``);
  }

  // Top projects
  const sorted = [...withPerms].sort((a, b) => b.totalCount - a.totalCount).slice(0, 10);
  lines.push(`## Top projects by permission count`);
  for (const e of sorted) {
    lines.push(`- ${e.shortName} (${e.fileType}): ${e.totalCount} permissions`);
  }
  lines.push(``);

  // Recommendations
  const hints: string[] = [];

  // 1. Common commands → suggest global
  const bashCmdProjects = new Map<string, Set<string>>();
  for (const r of results) {
    const dir = projectDir(r.display);
    for (const g of r.groups) {
      if (g.category !== 'Bash') continue;
      for (const item of g.items) {
        const cmd = extractCmd(item.name);
        if (!cmd) continue;
        if (!bashCmdProjects.has(cmd)) bashCmdProjects.set(cmd, new Set());
        bashCmdProjects.get(cmd)!.add(dir);
      }
    }
  }
  const frequent = [...bashCmdProjects.entries()]
    .filter(([, dirs]) => dirs.size >= 5)
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 5);
  if (frequent.length > 0) {
    const cmds = frequent.map(([cmd, dirs]) => `${cmd} (${dirs.size} projects)`).join(', ');
    hints.push(`Common commands found across many projects: ${cmds}. Consider adding these to ~/.claude/settings.json globally.`);
  }

  // 2. Heredoc cleanup
  let heredocTotal = 0;
  const heredocProjects = new Map<string, number>();
  for (const r of results) {
    let count = 0;
    for (const g of r.groups) {
      if (g.category !== 'Bash') continue;
      for (const item of g.items) {
        if (item.name.includes('__NEW_LINE_') || item.name.includes('<<') || item.name.includes('\\n')) count++;
      }
    }
    if (count > 0) {
      const dir = projectDir(r.display).replace(/.*\//, '');
      heredocProjects.set(dir, (heredocProjects.get(dir) || 0) + count);
      heredocTotal += count;
    }
  }
  if (heredocTotal > 0) {
    const top = [...heredocProjects.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const topStr = top.map(([p, c]) => `${p} (${c})`).join(', ');
    hints.push(`${heredocTotal} one-time/heredoc permissions found (${topStr}). Safe to remove.`);
  }

  // 3. WebFetch → suggest global wildcard
  let webFetchTotal = 0;
  let webFetchProjects = 0;
  for (const r of results) {
    const wf = r.groups.find((g) => g.category === 'WebFetch');
    if (wf) { webFetchTotal += wf.items.length; webFetchProjects++; }
  }
  const hasGlobalWebFetch = results.some((r) => r.isGlobal && r.groups.some((g) => g.category === 'WebFetch'));
  if (webFetchProjects >= 3 && !hasGlobalWebFetch) {
    hints.push(`WebFetch permissions found in ${webFetchProjects} projects (${webFetchTotal} domains total). WebFetch is read-only — add \`"WebFetch(*)"\` to ~/.claude/settings.json to skip per-domain approval globally.`);
  }

  // 4. Global check
  const globalEntries = entries.filter((e) => e.isGlobal);
  const globalPerms = globalEntries.reduce((sum, e) => sum + e.totalCount, 0);
  if (globalPerms === 0 && frequent.length > 0) {
    hints.push(`~/.claude/settings.json has no permissions. Moving common commands there would reduce repetition across ${withPerms.length} projects.`);
  }

  if (hints.length > 0) {
    lines.push(`## Recommendations`);
    for (let i = 0; i < hints.length; i++) {
      lines.push(`${i + 1}. ${hints[i]}`);
    }
    lines.push(``);
  }

  // How to act
  lines.push(`## How to act`);
  lines.push(`- Global settings: ~/.claude/settings.json`);
  lines.push(`- Project shared: <project>/.claude/settings.json (git tracked)`);
  lines.push(`- Project local: <project>/.claude/settings.local.json (gitignored)`);
  lines.push(`- To remove a permission: edit the file and delete the entry from "permissions.allow" array`);
  lines.push(``);
  lines.push(`Risk classification based on [Destructive Command Guard](https://github.com/Dicklesworthstone/destructive_command_guard)`);

  return lines.join('\n');
}
