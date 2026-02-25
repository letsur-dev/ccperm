// Pattern-based permission explainer
// Input is the "label" from categorize(), not the raw permission string

const BASH_COMMANDS: Record<string, [string, string]> = {
  // [description, risk: green/yellow/red]
  'git': ['Git version control', 'green'],
  'npm': ['Package manager (can run scripts)', 'yellow'],
  'npx': ['Run npm packages', 'yellow'],
  'node': ['Run Node.js scripts', 'yellow'],
  'bun': ['Bun runtime', 'yellow'],
  'deno': ['Deno runtime', 'yellow'],
  'python': ['Run Python scripts', 'yellow'],
  'python3': ['Run Python scripts', 'yellow'],
  'pip': ['Python package manager', 'yellow'],
  'pip3': ['Python package manager', 'yellow'],
  'docker': ['Container management', 'yellow'],
  'docker-compose': ['Multi-container management', 'yellow'],
  'curl': ['HTTP requests', 'yellow'],
  'wget': ['Download files', 'yellow'],
  'ssh': ['Remote shell access', 'red'],
  'scp': ['Remote file copy', 'red'],
  'rsync': ['File sync (local/remote)', 'yellow'],
  'rm': ['Delete files', 'red'],
  'chmod': ['Change permissions', 'yellow'],
  'chown': ['Change ownership', 'red'],
  'kill': ['Terminate processes', 'yellow'],
  'sudo': ['Superuser access', 'red'],
  'apt': ['System packages (Debian)', 'red'],
  'apt-get': ['System packages (Debian)', 'red'],
  'brew': ['Homebrew packages', 'yellow'],
  'make': ['Build automation', 'yellow'],
  'cargo': ['Rust build tool', 'yellow'],
  'go': ['Go build tool', 'yellow'],
  'mvn': ['Maven build', 'yellow'],
  'gradle': ['Gradle build', 'yellow'],
  'yarn': ['Package manager', 'yellow'],
  'pnpm': ['Package manager', 'yellow'],
  'tsc': ['TypeScript compiler', 'green'],
  'eslint': ['Linter', 'green'],
  'prettier': ['Formatter', 'green'],
  'jest': ['Test runner', 'green'],
  'vitest': ['Test runner', 'green'],
  'cat': ['Read files', 'green'],
  'ls': ['List directories', 'green'],
  'find': ['Search files', 'green'],
  'grep': ['Search text', 'green'],
  'sed': ['Stream editor', 'yellow'],
  'awk': ['Text processing', 'green'],
  'wc': ['Count lines/words', 'green'],
  'head': ['First lines of file', 'green'],
  'tail': ['Last lines of file', 'green'],
  'mkdir': ['Create directories', 'green'],
  'cp': ['Copy files', 'green'],
  'mv': ['Move/rename files', 'yellow'],
  'echo': ['Print text', 'green'],
  'env': ['Environment variables', 'green'],
  'which': ['Locate command', 'green'],
  'gh': ['GitHub CLI', 'yellow'],
  'heroku': ['Heroku CLI', 'yellow'],
  'vercel': ['Vercel CLI', 'yellow'],
  'aws': ['AWS CLI', 'red'],
  'gcloud': ['Google Cloud CLI', 'red'],
  'az': ['Azure CLI', 'red'],
  'kubectl': ['Kubernetes CLI', 'red'],
  'terraform': ['Infrastructure as Code', 'red'],
  'dd': ['Low-level disk copy', 'red'],
  'jq': ['JSON processor', 'green'],
  'bunx': ['Run bun packages', 'yellow'],
  'claude': ['Claude Code CLI', 'green'],
  'defaults': ['macOS defaults', 'yellow'],
};

const TOOL_DESCRIPTIONS: Record<string, [string, string]> = {
  'Read': ['Read file contents', 'green'],
  'Write': ['Create/overwrite files', 'yellow'],
  'Edit': ['Modify existing files', 'yellow'],
  'Glob': ['Search files by pattern', 'green'],
  'Grep': ['Search file contents', 'green'],
  'WebSearch': ['Web search', 'green'],
};

export interface PermInfo {
  description: string;
  risk: 'green' | 'yellow' | 'red';
}

// Extract first command word from a bash label like "git branch:*" or "npm run build"
function extractCmd(label: string): string {
  // Remove :* or * suffix patterns
  const clean = label.replace(/[:]\*.*$/, '').replace(/\s\*.*$/, '');
  // Get first word
  return clean.split(/[\s(]/)[0];
}

export function explainBash(label: string): PermInfo {
  const cmd = extractCmd(label);
  const entry = BASH_COMMANDS[cmd];
  if (entry) return { description: entry[0], risk: entry[1] as PermInfo['risk'] };
  return { description: '', risk: 'yellow' };
}

export function explainWebFetch(label: string): PermInfo {
  return { description: label, risk: 'yellow' };
}

export function explainMcp(label: string): PermInfo {
  const parts = label.replace(/^mcp__?/, '').split('__');
  const server = parts[0] || '';
  const tool = parts.slice(1).join(' ') || '';
  return { description: tool ? `${server}: ${tool}` : server, risk: 'yellow' };
}

export function explainTool(label: string): PermInfo {
  const toolName = label.match(/^(Read|Write|Edit|Glob|Grep|WebSearch)/)?.[1];
  if (toolName && TOOL_DESCRIPTIONS[toolName]) {
    const entry = TOOL_DESCRIPTIONS[toolName];
    return { description: entry[0], risk: entry[1] as PermInfo['risk'] };
  }
  return { description: '', risk: 'yellow' };
}

export function explain(category: string, label: string): PermInfo {
  if (category === 'Bash') return explainBash(label);
  if (category === 'WebFetch') return explainWebFetch(label);
  if (category === 'MCP') return explainMcp(label);
  if (category === 'Tools') return explainTool(label);
  return { description: '', risk: 'yellow' };
}
