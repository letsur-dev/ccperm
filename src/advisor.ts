import { ScanResult } from './scanner.js';
import { FileEntry, toFileEntries, projectDir } from './aggregator.js';

interface Hint {
  type: 'consolidate' | 'risk' | 'cleanup' | 'info';
  message: string;
}

const RISKY = new Set(['rm', 'sudo', 'chmod', 'chown', 'kill', 'dd', 'ssh', 'scp', 'aws', 'gcloud', 'az', 'kubectl', 'terraform']);

function extractCmd(label: string): string {
  return label.replace(/__NEW_LINE_[a-f0-9]+__\s*/, '').replace(/[:]\*.*$/, '').replace(/\s\*.*$/, '').split(/[\s(]/)[0];
}

export function analyze(results: ScanResult[]): string {
  const entries = toFileEntries(results);
  const withPerms = entries.filter((e) => e.totalCount > 0);
  const hints: Hint[] = [];

  // 1. Find frequently repeated bash commands → suggest global
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
    hints.push({
      type: 'consolidate',
      message: `Common commands found across many projects: ${cmds}. Consider adding these to ~/.claude/settings.json to allow globally instead of per-project.`,
    });
  }

  // 2. Find risky permissions
  const riskyFound: { cmd: string; project: string; file: string }[] = [];
  for (const r of results) {
    for (const g of r.groups) {
      if (g.category !== 'Bash') continue;
      for (const item of g.items) {
        const cmd = extractCmd(item.name);
        if (RISKY.has(cmd)) {
          const dir = projectDir(r.display);
          const shortDir = dir.replace(/.*\//, '');
          const file = r.display.includes('settings.local.json') ? 'local' : 'shared';
          riskyFound.push({ cmd, project: shortDir, file });
        }
      }
    }
  }
  if (riskyFound.length > 0) {
    const items = riskyFound.slice(0, 5).map((r) => `${r.cmd} in ${r.project} (${r.file})`).join(', ');
    hints.push({
      type: 'risk',
      message: `High-risk commands found: ${items}. Review if these are still needed.`,
    });
  }

  // 3. Find heredoc/one-time permissions
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
    }
  }
  if (heredocProjects.size > 0) {
    const total = [...heredocProjects.values()].reduce((a, b) => a + b, 0);
    const top = [...heredocProjects.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const topStr = top.map(([p, c]) => `${p} (${c})`).join(', ');
    hints.push({
      type: 'cleanup',
      message: `${total} one-time/heredoc permissions found (${topStr}). These were likely auto-allowed for single tasks and are safe to remove.`,
    });
  }

  // 4. Global permissions check
  const globalEntries = entries.filter((e) => e.isGlobal);
  const globalPerms = globalEntries.reduce((sum, e) => sum + e.totalCount, 0);
  if (globalPerms === 0 && frequent.length > 0) {
    hints.push({
      type: 'info',
      message: `~/.claude/settings.json has no permissions. Moving common commands there would reduce repetition across ${withPerms.length} projects.`,
    });
  }

  // Build output
  const lines: string[] = [];
  const dirs = new Set(results.map((r) => projectDir(r.display)));
  const totalPerms = results.reduce((sum, r) => sum + r.totalCount, 0);

  lines.push(`# ccperm: Permission Audit`);
  lines.push(``);
  lines.push(`Scanned ${results.length} settings files across ${dirs.size} projects. Found ${totalPerms} total permissions.`);
  lines.push(``);

  // Top projects
  const sorted = [...withPerms].sort((a, b) => b.totalCount - a.totalCount).slice(0, 10);
  lines.push(`## Top projects by permission count:`);
  for (const e of sorted) {
    lines.push(`- ${e.shortName} (${e.fileType}): ${e.totalCount} permissions`);
  }
  lines.push(``);

  if (hints.length > 0) {
    lines.push(`## Recommendations:`);
    for (let i = 0; i < hints.length; i++) {
      lines.push(`${i + 1}. ${hints[i].message}`);
    }
    lines.push(``);
  }

  lines.push(`## How to act:`);
  lines.push(`- Global settings: ~/.claude/settings.json`);
  lines.push(`- Project shared: <project>/.claude/settings.json (git tracked)`);
  lines.push(`- Project local: <project>/.claude/settings.local.json (gitignored)`);
  lines.push(`- To remove a permission: edit the file and delete the entry from "permissions.allow" array`);

  return lines.join('\n');
}
