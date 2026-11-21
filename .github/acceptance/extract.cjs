const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const unzip = require(process.env.NAGISA_FORGE_EXTRACT_MODULE);
const tar = path.join(process.env.SystemRoot, 'System32', 'tar.exe');
unzip.extractElectronZip = async (zip, directory) =>
  promisify(execFile)(tar, ['-xf', zip, '-C', directory], { windowsHide: true });
