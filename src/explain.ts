// Pattern-based permission explainer
// Risk levels inspired by Destructive Command Guard (DCG)
// https://github.com/Dicklesworthstone/destructive_command_guard

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface PermInfo {
  description: string;
  risk: Severity;
  domain?: string;  // DCG-style domain (e.g., "core.filesystem", "cloud.aws")
}

// Base command → [description, default severity, domain]
const BASH_COMMANDS: Record<string, [string, Severity, string]> = {
  // core.filesystem
  'rm': ['Delete files', 'high', 'core.filesystem'],
  'shred': ['Secure delete', 'critical', 'core.filesystem'],
  'dd': ['Low-level disk copy', 'critical', 'core.filesystem'],
  'mkfs': ['Format filesystem', 'critical', 'core.filesystem'],
  'chmod': ['Change permissions', 'high', 'system.permissions'],
  'chown': ['Change ownership', 'high', 'system.permissions'],
  'mv': ['Move/rename files', 'medium', 'core.filesystem'],
  'cp': ['Copy files', 'low', 'core.filesystem'],
  'mkdir': ['Create directories', 'low', 'core.filesystem'],

  // core.git
  'git': ['Git version control', 'low', 'core.git'],

  // system
  'sudo': ['Superuser access', 'critical', 'system.permissions'],
  'su': ['Switch user', 'critical', 'system.permissions'],
  'kill': ['Terminate processes', 'medium', 'system.services'],
  'pkill': ['Kill by name', 'medium', 'system.services'],
  'systemctl': ['Manage services', 'high', 'system.services'],
  'service': ['Manage services', 'high', 'system.services'],
  'journalctl': ['View logs', 'low', 'system.services'],

  // system packages
  'apt': ['System packages (Debian)', 'high', 'system.packages'],
  'apt-get': ['System packages (Debian)', 'high', 'system.packages'],
  'apt-cache': ['Package cache query', 'low', 'system.packages'],
  'dpkg': ['Debian packages', 'high', 'system.packages'],
  'brew': ['Homebrew packages', 'medium', 'system.packages'],
  'snap': ['Snap packages', 'medium', 'system.packages'],

  // remote
  'ssh': ['Remote shell access', 'high', 'remote.ssh'],
  'scp': ['Remote file copy', 'high', 'remote.scp'],
  'rsync': ['File sync (local/remote)', 'medium', 'remote.rsync'],

  // containers
  'docker': ['Container management', 'medium', 'containers.docker'],
  'docker-compose': ['Multi-container management', 'medium', 'containers.compose'],
  'podman': ['Container management', 'medium', 'containers.podman'],

  // kubernetes
  'kubectl': ['Kubernetes CLI', 'high', 'kubernetes.kubectl'],
  'helm': ['Kubernetes packages', 'high', 'kubernetes.helm'],

  // cloud
  'aws': ['AWS CLI', 'high', 'cloud.aws'],
  'gcloud': ['Google Cloud CLI', 'high', 'cloud.gcp'],
  'az': ['Azure CLI', 'high', 'cloud.azure'],
  'terraform': ['Infrastructure as Code', 'critical', 'infrastructure.terraform'],
  'pulumi': ['Infrastructure as Code', 'high', 'infrastructure.pulumi'],
  'ansible': ['Configuration management', 'high', 'infrastructure.ansible'],

  // networking
  'curl': ['HTTP requests', 'medium', 'networking'],
  'wget': ['Download files', 'medium', 'networking'],
  'ss': ['Socket statistics', 'low', 'networking'],
  'netstat': ['Network statistics', 'low', 'networking'],
  'ip': ['Network config', 'low', 'networking'],
  'ping': ['Network connectivity test', 'low', 'networking'],
  'dig': ['DNS lookup', 'low', 'networking'],
  'nslookup': ['DNS lookup', 'low', 'networking'],
  'traceroute': ['Trace network route', 'low', 'networking'],
  'tailscale': ['Tailscale VPN', 'medium', 'networking'],
  'cloudflared': ['Cloudflare tunnel', 'medium', 'networking'],

  // databases
  'psql': ['PostgreSQL client', 'high', 'database.postgresql'],
  'mysql': ['MySQL client', 'high', 'database.mysql'],
  'sqlite3': ['SQLite client', 'medium', 'database.sqlite'],
  'redis-cli': ['Redis client', 'high', 'database.redis'],
  'mongosh': ['MongoDB shell', 'high', 'database.mongodb'],

  // runtimes
  'node': ['Run Node.js scripts', 'medium', 'runtime'],
  'python': ['Run Python scripts', 'medium', 'runtime'],
  'python3': ['Run Python scripts', 'medium', 'runtime'],
  'bun': ['Bun runtime', 'medium', 'runtime'],
  'deno': ['Deno runtime', 'medium', 'runtime'],
  'go': ['Go build tool', 'medium', 'runtime'],
  'cargo': ['Rust build tool', 'medium', 'runtime'],
  'rustc': ['Rust compiler', 'low', 'runtime'],

  // package managers
  'npm': ['Package manager (can run scripts)', 'medium', 'packages'],
  'npx': ['Run npm packages', 'medium', 'packages'],
  'bunx': ['Run bun packages', 'medium', 'packages'],
  'yarn': ['Package manager', 'medium', 'packages'],
  'pnpm': ['Package manager', 'medium', 'packages'],
  'pip': ['Python package manager', 'medium', 'packages'],
  'pip3': ['Python package manager', 'medium', 'packages'],
  'uv': ['Python package manager', 'medium', 'packages'],

  // build tools
  'make': ['Build automation', 'medium', 'build'],
  'tsc': ['TypeScript compiler', 'low', 'build'],
  'mvn': ['Maven build', 'medium', 'build'],
  'gradle': ['Gradle build', 'medium', 'build'],

  // deploy
  'vercel': ['Vercel CLI', 'medium', 'deploy'],
  'heroku': ['Heroku CLI', 'medium', 'deploy'],
  'rclone': ['Cloud storage sync', 'medium', 'storage'],

  // safe tools
  'cat': ['Read files', 'low', 'read'],
  'ls': ['List directories', 'low', 'read'],
  'find': ['Search files', 'low', 'read'],
  'grep': ['Search text', 'low', 'read'],
  'head': ['First lines of file', 'low', 'read'],
  'tail': ['Last lines of file', 'low', 'read'],
  'wc': ['Count lines/words', 'low', 'read'],
  'sort': ['Sort lines', 'low', 'read'],
  'tree': ['Directory tree', 'low', 'read'],
  'echo': ['Print text', 'low', 'read'],
  'env': ['Environment variables', 'low', 'read'],
  'which': ['Locate command', 'low', 'read'],
  'jq': ['JSON processor', 'low', 'read'],
  'sed': ['Stream editor', 'medium', 'text'],
  'awk': ['Text processing', 'low', 'text'],
  'xargs': ['Build commands from stdin', 'medium', 'text'],
  'source': ['Run shell script', 'medium', 'shell'],
  'bash': ['Run shell', 'medium', 'shell'],
  'sh': ['Run shell', 'medium', 'shell'],

  // linters/formatters
  'eslint': ['Linter', 'low', 'dev'],
  'prettier': ['Formatter', 'low', 'dev'],
  'jest': ['Test runner', 'low', 'dev'],
  'vitest': ['Test runner', 'low', 'dev'],
  'pytest': ['Python test runner', 'low', 'dev'],

  // platform
  'gh': ['GitHub CLI', 'medium', 'platform.github'],
  'claude': ['Claude Code CLI', 'low', 'platform'],
};

// Context-aware patterns that UPGRADE severity
// Regex matched against the FULL permission string (not just command name)
const CRITICAL_PATTERNS: [RegExp, string, string][] = [
  // core.filesystem
  [/rm\s+.*-[a-z]*r[a-z]*f|rm\s+.*-[a-z]*f[a-z]*r|rm\s+-rf/, 'Recursive force delete', 'core.filesystem'],
  [/rm\s+.*\/\*|rm\s+~/, 'Delete broad path', 'core.filesystem'],
  // core.git
  [/git\s+push\s+.*--force|git\s+push\s+.*-f\b/, 'Force push (destroys remote history)', 'core.git'],
  [/git\s+reset\s+--hard/, 'Hard reset (destroys uncommitted changes)', 'core.git'],
  [/git\s+clean\s+-f/, 'Remove untracked files permanently', 'core.git'],
  [/git\s+stash\s+clear/, 'Delete all stashed changes', 'core.git'],
  [/git\s+filter-branch/, 'Permanent history rewrite', 'core.git'],
  // containers
  [/docker\s+system\s+prune/, 'Prune all docker data', 'containers.docker'],
  [/docker\s+volume\s+prune/, 'Delete all unused volumes', 'containers.docker'],
  // kubernetes
  [/kubectl\s+delete\s+namespace/, 'Delete entire namespace', 'kubernetes.kubectl'],
  [/kubectl\s+delete.*--all/, 'Delete all resources', 'kubernetes.kubectl'],
  [/kubectl\s+delete\s+pvc/, 'Delete persistent volume claim', 'kubernetes.kubectl'],
  // cloud
  [/aws\s+s3\s+rb|aws\s+s3\s+rm.*--recursive/, 'Delete S3 data', 'cloud.aws'],
  [/aws\s+ec2\s+terminate/, 'Terminate EC2 instances', 'cloud.aws'],
  [/aws\s+rds\s+delete/, 'Delete RDS database', 'cloud.aws'],
  [/aws\s+iam\s+delete/, 'Delete IAM resource', 'cloud.aws'],
  [/terraform\s+destroy/, 'Destroy infrastructure', 'infrastructure.terraform'],
  [/terraform\s+apply\s+.*-auto-approve/, 'Auto-approve infrastructure changes', 'infrastructure.terraform'],
  // system
  [/chmod\s+777|chmod\s+-R/, 'Broad permission change', 'system.permissions'],
  [/chmod\s+000/, 'Remove all file access', 'system.permissions'],
  [/iptables\s+-F/, 'Flush firewall rules', 'system.network'],
  [/\beval\b/, 'Arbitrary code execution', 'system'],
  // catch-all dangerous
  [/mkfs|shred|wipefs/, 'Disk destruction', 'core.filesystem'],
  [/curl.*\|\s*sh|curl.*\|\s*bash|wget.*\|\s*sh/, 'Pipe to shell (remote code execution)', 'networking'],
  // database destructive
  [/DROP\s+DATABASE/i, 'Drop database', 'database'],
  [/DROP\s+TABLE/i, 'Drop table', 'database'],
  [/DROP\s+SCHEMA.*CASCADE/i, 'Drop schema cascade', 'database'],
  [/TRUNCATE/i, 'Truncate table data', 'database'],
];

const HIGH_PATTERNS: [RegExp, string, string][] = [
  // core.git
  [/git\s+push/, 'Push to remote', 'core.git'],
  [/git\s+rebase/, 'Rewrite commit history', 'core.git'],
  [/git\s+branch\s+-D/, 'Force delete branch', 'core.git'],
  [/git\s+checkout\s+.*--/, 'Discard uncommitted changes', 'core.git'],
  [/git\s+stash\s+drop/, 'Drop stashed changes', 'core.git'],
  // containers
  [/docker\s+rm/, 'Remove containers', 'containers.docker'],
  [/docker\s+run/, 'Run container', 'containers.docker'],
  [/docker\s+image\s+prune.*--all/, 'Delete all images', 'containers.docker'],
  // kubernetes
  [/kubectl\s+drain/, 'Evict pods from node', 'kubernetes.kubectl'],
  [/kubectl\s+scale.*--replicas=0/, 'Scale to zero (service down)', 'kubernetes.kubectl'],
  [/helm\s+uninstall|helm\s+delete/, 'Uninstall Helm release', 'kubernetes.helm'],
  // cloud
  [/aws\s+ecs/, 'ECS management', 'cloud.aws'],
  [/aws\s+codepipeline/, 'CI/CD pipeline', 'cloud.aws'],
  [/aws\s+ssm/, 'Systems Manager', 'cloud.aws'],
  [/aws\s+lambda\s+delete/, 'Delete Lambda function', 'cloud.aws'],
  [/gcloud.*delete/, 'Delete GCP resource', 'cloud.gcp'],
  // remote
  [/rsync.*--delete/, 'Sync with deletion', 'remote.rsync'],
  // deploy
  [/npm\s+publish/, 'Publish to npm', 'packages'],
  [/vercel\s+--prod/, 'Deploy to production', 'deploy'],
  // database
  [/redis-cli.*FLUSHALL/i, 'Flush all Redis data', 'database.redis'],
  [/redis-cli.*FLUSHDB/i, 'Flush Redis database', 'database.redis'],
  // secrets
  [/vault\s+delete/, 'Delete Vault secret', 'secrets.vault'],
];

// Write path risk assessment
const WRITE_CRITICAL: RegExp[] = [
  /\*\*\/\*\.key/, /\*\*\/\*\.pem/, /\.env/,
  /credentials/, /secrets/, /\.ssh/,
];

const TOOL_DESCRIPTIONS: Record<string, [string, Severity]> = {
  'Read': ['Read file contents', 'low'],
  'Write': ['Create/overwrite files', 'medium'],
  'Edit': ['Modify existing files', 'medium'],
  'Glob': ['Search files by pattern', 'low'],
  'Grep': ['Search file contents', 'low'],
  'WebSearch': ['Web search', 'low'],
};

// Shell keywords that are not real commands — skip to find the actual command
const SHELL_KEYWORDS = new Set([
  'do', 'done', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until',
  'if', 'case', 'esac', 'in', 'select',
]);

// Extract first command word from a bash label
function extractCmd(label: string): string {
  const clean = label
    .replace(/__NEW_LINE_[a-f0-9]+__\s*/, '')
    .replace(/[:]\*.*$/, '')
    .replace(/\s\*.*$/, '');
  const words = clean.split(/[\s(]/);
  // Skip shell keywords to find the real command
  for (const w of words) {
    if (w && !SHELL_KEYWORDS.has(w)) return w;
  }
  return words[0];
}

export function explainBash(label: string): PermInfo {
  // Check critical patterns first (full string match)
  for (const [re, desc, domain] of CRITICAL_PATTERNS) {
    if (re.test(label)) return { description: desc, risk: 'critical', domain };
  }
  // Check high patterns
  for (const [re, desc, domain] of HIGH_PATTERNS) {
    if (re.test(label)) return { description: desc, risk: 'high', domain };
  }
  // Fall back to command-level lookup
  const cmd = extractCmd(label);
  const entry = BASH_COMMANDS[cmd];
  if (entry) return { description: entry[0], risk: entry[1], domain: entry[2] };
  // Bare "Bash" with no command = full shell access
  if (label.trim() === 'Bash' || label.trim() === '') return { description: 'Unrestricted shell access', risk: 'critical', domain: 'system' };
  return { description: '', risk: 'medium' };
}

export function explainWebFetch(label: string): PermInfo {
  return { description: label, risk: 'low', domain: 'networking' };
}

export function explainMcp(label: string): PermInfo {
  const parts = label.replace(/^mcp__?/, '').split('__');
  const server = parts[0] || '';
  const tool = parts.slice(1).join(' ') || '';
  return { description: tool ? `${server}: ${tool}` : server, risk: 'medium', domain: 'mcp' };
}

export function explainTool(label: string): PermInfo {
  // Check Write paths for sensitive targets
  if (label.startsWith('Write:')) {
    const path = label.slice(6);
    for (const re of WRITE_CRITICAL) {
      if (re.test(path)) return { description: `Write to sensitive path: ${path}`, risk: 'critical', domain: 'core.filesystem' };
    }
    return { description: `Write to ${path}`, risk: 'medium', domain: 'core.filesystem' };
  }
  const toolName = label.match(/^(Read|Write|Edit|Glob|Grep|WebSearch)/)?.[1];
  if (toolName && TOOL_DESCRIPTIONS[toolName]) {
    const entry = TOOL_DESCRIPTIONS[toolName];
    return { description: entry[0], risk: entry[1] };
  }
  return { description: '', risk: 'medium' };
}

export function explain(category: string, label: string): PermInfo {
  if (category === 'Bash') return explainBash(label);
  if (category === 'MCP') return explainMcp(label);
  if (category === 'Tools') {
    if (label.startsWith('WebFetch')) return explainWebFetch(label);
    return explainTool(label);
  }
  return { description: '', risk: 'medium' };
}
