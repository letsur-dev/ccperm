// Pattern-based permission explainer

const BASH_COMMANDS: Record<string, [string, string]> = {
  // [description, risk: green/yellow/red]
  'git': ['Git version control commands', 'green'],
  'npm': ['Node.js package manager — can run scripts', 'yellow'],
  'npx': ['Run npm packages — can execute arbitrary code', 'yellow'],
  'node': ['Run Node.js scripts', 'yellow'],
  'bun': ['Bun runtime — run scripts, install packages', 'yellow'],
  'deno': ['Deno runtime — run scripts', 'yellow'],
  'python': ['Run Python scripts', 'yellow'],
  'python3': ['Run Python scripts', 'yellow'],
  'pip': ['Python package manager — can run setup scripts', 'yellow'],
  'pip3': ['Python package manager — can run setup scripts', 'yellow'],
  'docker': ['Docker container management', 'yellow'],
  'docker-compose': ['Docker Compose multi-container management', 'yellow'],
  'curl': ['HTTP requests from command line', 'yellow'],
  'wget': ['Download files from the web', 'yellow'],
  'ssh': ['Remote shell access', 'red'],
  'scp': ['Remote file copy over SSH', 'red'],
  'rsync': ['File synchronization (local or remote)', 'yellow'],
  'rm': ['Delete files and directories', 'red'],
  'chmod': ['Change file permissions', 'yellow'],
  'chown': ['Change file ownership', 'red'],
  'kill': ['Terminate processes', 'yellow'],
  'sudo': ['Run commands as superuser', 'red'],
  'apt': ['System package manager (Debian/Ubuntu)', 'red'],
  'apt-get': ['System package manager (Debian/Ubuntu)', 'red'],
  'brew': ['Homebrew package manager (macOS)', 'yellow'],
  'make': ['Build automation — runs Makefile targets', 'yellow'],
  'cargo': ['Rust package manager and build tool', 'yellow'],
  'go': ['Go build and package tool', 'yellow'],
  'mvn': ['Maven Java build tool', 'yellow'],
  'gradle': ['Gradle build tool', 'yellow'],
  'yarn': ['Yarn package manager — can run scripts', 'yellow'],
  'pnpm': ['pnpm package manager — can run scripts', 'yellow'],
  'tsc': ['TypeScript compiler', 'green'],
  'eslint': ['JavaScript/TypeScript linter', 'green'],
  'prettier': ['Code formatter', 'green'],
  'jest': ['JavaScript test runner', 'green'],
  'vitest': ['Vite-based test runner', 'green'],
  'cat': ['Read file contents', 'green'],
  'ls': ['List directory contents', 'green'],
  'find': ['Search for files', 'green'],
  'grep': ['Search text patterns in files', 'green'],
  'sed': ['Stream editor — modify file contents', 'yellow'],
  'awk': ['Text processing language', 'green'],
  'wc': ['Count lines/words/bytes', 'green'],
  'head': ['Show first lines of file', 'green'],
  'tail': ['Show last lines of file', 'green'],
  'mkdir': ['Create directories', 'green'],
  'cp': ['Copy files', 'green'],
  'mv': ['Move/rename files', 'yellow'],
  'echo': ['Print text', 'green'],
  'env': ['Show/set environment variables', 'green'],
  'which': ['Locate a command', 'green'],
  'gh': ['GitHub CLI — repos, PRs, issues', 'yellow'],
  'heroku': ['Heroku platform CLI', 'yellow'],
  'vercel': ['Vercel deployment CLI', 'yellow'],
  'aws': ['AWS CLI — cloud infrastructure', 'red'],
  'gcloud': ['Google Cloud CLI', 'red'],
  'az': ['Azure CLI', 'red'],
  'kubectl': ['Kubernetes cluster management', 'red'],
  'terraform': ['Infrastructure as Code', 'red'],
};

const TOOL_DESCRIPTIONS: Record<string, string> = {
  'Read': 'Read file contents from disk',
  'Write': 'Create or overwrite files',
  'Edit': 'Modify existing files (partial edits)',
  'Glob': 'Search for files by name pattern',
  'Grep': 'Search file contents with regex',
  'WebSearch': 'Search the web via search engine',
};

export interface PermInfo {
  description: string;
  risk: 'green' | 'yellow' | 'red';
  detail?: string;
}

export function explainPermission(perm: string): PermInfo {
  // Bash permissions
  const bashMatch = perm.match(/^Bash\((.+?)[\s)]/);
  if (bashMatch || perm === 'Bash') {
    const cmd = bashMatch ? bashMatch[1] : '';
    const entry = BASH_COMMANDS[cmd];
    if (entry) {
      return { description: entry[0], risk: entry[1] as PermInfo['risk'], detail: `Command: ${cmd}` };
    }
    if (cmd) {
      return { description: `Run "${cmd}" command`, risk: 'yellow', detail: `Command: ${cmd}` };
    }
    return { description: 'Run shell commands', risk: 'red' };
  }

  // WebFetch
  const fetchMatch = perm.match(/^WebFetch\(domain:(.+)\)$/);
  if (fetchMatch) {
    const domain = fetchMatch[1];
    return { description: `HTTP requests to ${domain}`, risk: 'yellow', detail: `Domain: ${domain}` };
  }
  if (perm.startsWith('WebFetch')) {
    return { description: 'HTTP requests to external URLs', risk: 'yellow' };
  }

  // MCP tools
  if (perm.startsWith('mcp__') || perm.startsWith('mcp_')) {
    const parts = perm.split('__');
    const server = parts[1] || 'unknown';
    const tool = parts.slice(2).join('__') || 'unknown';
    return { description: `MCP: ${server} → ${tool}`, risk: 'yellow', detail: `Server: ${server}, Tool: ${tool}` };
  }

  // Standard tools
  const toolName = perm.match(/^(Read|Write|Edit|Glob|Grep|WebSearch)/)?.[1];
  if (toolName && TOOL_DESCRIPTIONS[toolName]) {
    return { description: TOOL_DESCRIPTIONS[toolName], risk: 'green' };
  }

  return { description: perm, risk: 'yellow' };
}
