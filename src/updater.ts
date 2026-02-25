import https from 'node:https';

interface PkgJson {
  name: string;
  version: string;
}

function getPkg(): PkgJson {
  return require('../package.json');
}

function fetchLatestVersion(name: string): Promise<string | null> {
  return new Promise((resolve) => {
    const req = https.get(`https://registry.npmjs.org/${name}/latest`, { timeout: 3000 }, (res) => {
      if (res.statusCode !== 200) { resolve(null); return; }
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data).version); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function compareVersions(current: string, latest: string): boolean {
  const c = current.split('.').map(Number);
  const l = latest.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((l[i] || 0) > (c[i] || 0)) return true;
    if ((l[i] || 0) < (c[i] || 0)) return false;
  }
  return false;
}

export async function checkUpdate(): Promise<{ current: string; latest: string } | null> {
  const pkg = getPkg();
  const latest = await fetchLatestVersion(pkg.name);
  if (!latest || !compareVersions(pkg.version, latest)) return null;
  return { current: pkg.version, latest };
}

export function getVersion(): string {
  return getPkg().version;
}
