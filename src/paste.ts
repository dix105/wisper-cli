import { spawnSync } from 'node:child_process';
import clipboard from 'clipboardy';

export async function pasteIntoActiveApp(text: string) {
  await clipboard.write(text);

  if (process.platform === 'darwin') {
    spawnSync('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down'], { stdio: 'ignore' });
    return;
  }

  if (process.platform === 'win32') {
    const script = 'Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Milliseconds 80; [System.Windows.Forms.SendKeys]::SendWait("^v")';
    spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { stdio: 'ignore' });
    return;
  }

  spawnSync('xdotool', ['key', 'ctrl+v'], { stdio: 'ignore' });
}
