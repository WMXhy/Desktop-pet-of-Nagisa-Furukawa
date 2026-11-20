const { execFileSync } = require('node:child_process');
const { mkdirSync, statSync } = require('node:fs');
const { join, resolve } = require('node:path');

if (process.platform === 'win32') {
  const root = resolve(__dirname, '..');
  const output = join(root, '.windows-helper', process.argv[2] === 'package' ? 'package' : 'dev');
  mkdirSync(output, { recursive: true });
  const source = join(__dirname, 'windows-desktop-state.cs');
  const destination = join(output, 'NagisaDesktopState.exe');
  const previous = statSync(destination, { throwIfNoEntry: false });
  const compiler = join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  if (!previous || previous.mtimeMs < Math.max(statSync(source).mtimeMs, statSync(__filename).mtimeMs)) {
    execFileSync(compiler, ['/nologo', '/optimize+', '/platform:anycpu', '/target:exe', '/out:' + destination, source],
      { windowsHide: true, stdio: 'inherit' });
  }
}
