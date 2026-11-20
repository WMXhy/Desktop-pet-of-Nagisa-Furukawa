import { app } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

export type DesktopState = { fullscreen: boolean; notificationsAllowed: boolean };

export function watchDesktop(update: (state: DesktopState) => void): () => void {
  if (process.platform !== 'win32') return () => {};
  const executable = app.isPackaged ? join(process.resourcesPath, 'NagisaDesktopState.exe')
    : join(app.getAppPath(), '.windows-helper', 'dev', 'NagisaDesktopState.exe');
  let child: ChildProcessWithoutNullStreams;
  let retry: ReturnType<typeof setTimeout>;
  let stopped = false;
  let warned = false;
  function start() {
    child = spawn(executable, [String(process.pid)], { windowsHide: true });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    const output = createInterface({ input: child.stdout });
    output.on('line', (line) => {
      if (!stopped && /^[01]:[01]$/.test(line)) update({ fullscreen: line[0] === '1', notificationsAllowed: line[2] === '1' });
    });
    child.on('error', (error) => {
      if (!warned) console.warn('桌面免打扰状态无法读取', error);
      warned = true;
    });
    child.once('close', () => {
      output.close();
      if (!stopped) {
        update({ fullscreen: false, notificationsAllowed: false });
        retry = setTimeout(start, 10_000);
      }
    });
  }
  start();
  return () => { stopped = true; clearTimeout(retry); child.stdin.end(); };
}
