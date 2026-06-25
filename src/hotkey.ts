import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { GlobalKeyboardListener } = require('node-global-key-listener') as {
  GlobalKeyboardListener: new () => {
    addListener(listener: (event: KeyEvent, down: Record<string, boolean>) => void): void;
    kill?: () => void;
  };
};

type KeyEvent = {
  name?: string;
  rawKey?: { name?: string };
  state?: 'DOWN' | 'UP';
};

function normalizeKey(key: string) {
  return key
    .trim()
    .toUpperCase()
    .replace(/^LEFT /, '')
    .replace(/^RIGHT /, '')
    .replace('CONTROL', 'CTRL')
    .replace('COMMAND', 'META')
    .replace('CMD', 'META')
    .replace('OPTION', 'ALT')
    .replace(' ', 'SPACE');
}

export function normalizeShortcut(shortcut: string) {
  return shortcut
    .split('+')
    .map(normalizeKey)
    .filter(Boolean)
    .sort()
    .join('+');
}

function eventName(event: KeyEvent) {
  return normalizeKey(event.name || event.rawKey?.name || '');
}

function activeShortcut(down: Record<string, boolean>, currentKey: string) {
  const keys = Object.entries(down)
    .filter(([, pressed]) => pressed)
    .map(([key]) => normalizeKey(key));
  if (!keys.includes(currentKey)) keys.push(currentKey);
  return keys.sort().join('+');
}

export function listenForShortcut(shortcut: string, onPress: () => void) {
  const target = normalizeShortcut(shortcut);
  const keyboard = new GlobalKeyboardListener();
  let armed = true;

  keyboard.addListener((event, down) => {
    const key = eventName(event);
    if (!key) return;

    if (event.state === 'UP') {
      armed = true;
      return;
    }

    if (!armed) return;
    if (activeShortcut(down, key) === target) {
      armed = false;
      onPress();
    }
  });

  return () => keyboard.kill?.();
}
