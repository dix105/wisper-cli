import { spawnSync } from 'node:child_process';

export function listInputDevices(): string[] {
  if (process.platform !== 'win32') return ['default'];

  const script = `Get-PnpDevice -Class AudioEndpoint | Where-Object { $_.Status -eq 'OK' -and $_.FriendlyName -match 'Microphone|Mic' } | Select-Object -ExpandProperty FriendlyName`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', windowsHide: true });
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function preferredInputDevice(configured?: string) {
  if (configured) return configured;
  if (process.platform !== 'win32') return 'default';

  const devices = listInputDevices();
  return devices.find((device) => !/virtual|relay/i.test(device)) || devices[0] || 'default';
}
