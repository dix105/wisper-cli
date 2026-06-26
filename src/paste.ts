import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import clipboard from 'clipboardy';

export async function pasteIntoActiveApp(text: string) {
  await clipboard.write(text);

  if (process.platform === 'darwin') {
    spawnSync('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down'], { stdio: 'ignore' });
    return;
  }

  if (process.platform === 'win32') {
    const scriptPath = join(tmpdir(), `wisper-paste-${process.pid}.vbs`);
    writeFileSync(scriptPath, 'Set WshShell = WScript.CreateObject("WScript.Shell")\nWshShell.SendKeys "^v"\n');
    spawnSync('wscript.exe', ['//B', scriptPath], { stdio: 'ignore', windowsHide: true });
    try { unlinkSync(scriptPath); } catch {}
    return;
  }

  spawnSync('xdotool', ['key', 'ctrl+v'], { stdio: 'ignore' });
}
