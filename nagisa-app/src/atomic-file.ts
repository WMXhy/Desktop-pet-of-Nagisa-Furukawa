import { renameSync, writeFileSync } from 'node:fs';

export function writeAtomic(file: string, contents: string, temporarySuffix = '.tmp') {
  const temporary = file + temporarySuffix;
  writeFileSync(temporary, contents, { encoding: 'utf8', flush: true });
  renameSync(temporary, file);
}
