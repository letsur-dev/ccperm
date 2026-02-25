import fs from 'node:fs';

export interface FixResult {
  totalPatterns: number;
  fixedFiles: number;
}

export function fixFiles(files: { path: string; count: number }[]): FixResult {
  let totalPatterns = 0;
  let fixedFiles = 0;

  for (const { path: f, count } of files) {
    totalPatterns += count;
    try {
      let content = fs.readFileSync(f, 'utf8');
      content = content.replace(/:\*\)/g, ' *)').replace(/:\*"/g, ' *"');
      fs.writeFileSync(f, content, 'utf8');
      fixedFiles++;
    } catch { /* skip unwritable */ }
  }

  return { totalPatterns, fixedFiles };
}
