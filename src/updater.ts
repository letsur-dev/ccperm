import updateNotifier from 'update-notifier';

interface PkgJson {
  name: string;
  version: string;
}

function getPkg(): PkgJson {
  return require('../package.json');
}

export function getVersion(): string {
  return getPkg().version;
}

export function notifyUpdate(): void {
  const pkg = getPkg();
  const notifier = updateNotifier({ pkg, updateCheckInterval: 1000 * 60 * 60 * 24 }); // 1 day
  notifier.notify({ isGlobal: true });
}
