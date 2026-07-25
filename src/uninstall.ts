import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { disableAutostart } from './autostart.js';
import { stopListener } from './process-state.js';

function appDir() {
  return dirname(dirname(fileURLToPath(new URL('./cli.js', import.meta.url))));
}

function binDir() {
  return process.env.WISPER_BIN_DIR || join(homedir(), '.local', 'bin');
}

async function stopDashboard() {
  try {
    const pid = Number((await readFile(join(homedir(), '.notebot', 'dashboard.pid'), 'utf8')).trim());
    if (Number.isFinite(pid) && pid > 0 && pid !== process.pid) process.kill(pid, 'SIGTERM');
  } catch {
    // Dashboard is optional and may not be running.
  }
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function scheduleWindowsRemoval(installDir: string, purge: boolean) {
  const script = join(tmpdir(), `nextbase-uninstall-${Date.now()}.ps1`);
  const parentPid = process.pid;
  const wrappers = ['nextbase.cmd', 'wisper.cmd', 'notebot.cmd'].map((name) => join(binDir(), name));
  const cleanup = purge ? `Remove-Item ${JSON.stringify(join(homedir(), '.wisper-cli'))} -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item ${JSON.stringify(join(homedir(), '.notebot'))} -Recurse -Force -ErrorAction SilentlyContinue` : '';
  await writeFile(script, `$ErrorActionPreference = 'SilentlyContinue'
$parent = ${parentPid}
while (Get-Process -Id $parent -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 250 }
Remove-Item ${JSON.stringify(installDir)} -Recurse -Force
${wrappers.map((file) => `Remove-Item ${JSON.stringify(file)} -Force`).join('\n')}
${cleanup}
Remove-Item $PSCommandPath -Force
`);
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

async function scheduleUnixRemoval(installDir: string, purge: boolean) {
  const script = join(tmpdir(), `nextbase-uninstall-${Date.now()}.sh`);
  const parentPid = process.pid;
  const links = [
    ['nextbase', join(installDir, 'dist', 'nextbase-cli.js')],
    ['wisper', join(installDir, 'dist', 'cli.js')],
    ['notebot', join(installDir, 'dist', 'notebot-cli.js')]
  ];
  const removeLinks = links.map(([name, target]) => `if [ "$(readlink ${shellQuote(join(binDir(), name))} 2>/dev/null)" = ${shellQuote(target)} ]; then rm -f ${shellQuote(join(binDir(), name))}; fi`).join('\n');
  const cleanup = purge ? `rm -rf ${shellQuote(join(homedir(), '.wisper-cli'))} ${shellQuote(join(homedir(), '.notebot'))}` : '';
  await writeFile(script, `#!/bin/sh
while kill -0 ${parentPid} 2>/dev/null; do sleep 0.25; done
rm -rf ${shellQuote(installDir)}
${removeLinks}
${cleanup}
rm -f "$0"
`);
  await chmod(script, 0o700);
  const child = spawn('sh', [script], { detached: true, stdio: 'ignore' });
  child.unref();
}

export async function uninstallNextbase(options: { purge: boolean }) {
  const installDir = appDir();
  await disableAutostart();
  await stopListener();
  await stopDashboard();
  await mkdir(tmpdir(), { recursive: true });
  if (process.platform === 'win32') await scheduleWindowsRemoval(installDir, options.purge);
  else await scheduleUnixRemoval(installDir, options.purge);

  return options.purge
    ? 'Nextbase CLI is uninstalling. App, commands, config, history, recordings, and NoteBot data will be removed after this command exits.'
    : 'Nextbase CLI is uninstalling. App, commands, and background services will be removed after this command exits. Local config, history, recordings, and NoteBot data are kept.';
}
