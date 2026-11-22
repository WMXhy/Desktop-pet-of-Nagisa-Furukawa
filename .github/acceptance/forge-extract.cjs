const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

require(process.env.NAGISA_FORGE_EXTRACT_MODULE).extractElectronZip = async (zipPath, target) => {
  mkdirSync(target, { recursive: true });
  const tar = join(process.env.SystemRoot, 'System32', 'tar.exe');
  const result = spawnSync(tar, ['-xf', zipPath, '-C', target], { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Electron extraction failed: ${result.status}`);
};
