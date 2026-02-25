const enabled = process.stdout.isTTY !== false;

const wrap = (code: string) => (enabled ? code : '');

export const RED = wrap('\x1b[0;31m');
export const GREEN = wrap('\x1b[0;32m');
export const YELLOW = wrap('\x1b[1;33m');
export const CYAN = wrap('\x1b[0;36m');
export const DIM = wrap('\x1b[2m');
export const BOLD = wrap('\x1b[1m');
export const NC = wrap('\x1b[0m');
