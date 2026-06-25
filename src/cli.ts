#!/usr/bin/env node
import { loadHistory, saveTranscript } from './storage.js';
import { startWebApp } from './server.js';
import { openUrl } from './open.js';
import { defaultShortcut, loadConfig, modelOptions, providers, updateConfig, type ModelOption, type Provider } from './config.js';
import { createPrompt } from './prompt.js';
import { enableAutostart, startListenerNow } from './autostart.js';
import { verifyProviderKey } from './verify.js';

const [command, ...args] = process.argv.slice(2);

async function main() {
  switch (command) {
    case undefined:
    case 'help':
      printHelp();
      break;
    case 'setup':
      await setup();
      break;
    case 'provider':
      await selectProvider();
      break;
    case 'shortcut':
      await setShortcut();
      break;
    case 'status':
      await showStatus();
      break;
    case 'listen':
      await listen();
      break;
    case 'history': {
      const history = await loadHistory();
      if (!history.length) return console.log('No transcripts yet.');
      for (const item of history.slice(0, Number(args[0] || 20))) {
        console.log(`${item.createdAt}  ${item.text}`);
      }
      break;
    }
    case 'add': {
      const text = args.join(' ').trim();
      if (!text) throw new Error('Usage: wisper add "text"');
      const item = await saveTranscript(text);
      console.log(`Saved transcript ${item.id}`);
      break;
    }
    case 'app':
    case 'open': {
      const url = await startWebApp(Number(args[0] || 3838));
      openUrl(url);
      console.log(`Wisper web app running at ${url}`);
      console.log('Press Ctrl+C to stop.');
      break;
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function printHelp() {
  console.log(`wisper-cli

Commands:
  wisper setup            Simple first-time setup
  wisper provider         Pick provider from a menu
  wisper shortcut         Set shortcut from a prompt
  wisper status           Show current setup
  wisper listen           Run background listener
  wisper app              Open local web app
  wisper open             Alias for app
  wisper history [limit]  Print transcript history
  wisper add "text"       Save a manual transcript
  wisper help             Show help
`);
}

async function setup() {
  console.log('Wisper setup');
  const prompt = createPrompt();
  try {
    await selectModel(prompt);
    await setShortcut(true, prompt);
    const wantsAutostart = await prompt.confirm('Start Wisper automatically on computer startup?', true);
    if (wantsAutostart) {
      const result = await enableAutostart();
      await updateConfig({ autostart: result.enabled });
      console.log(result.message);
    } else {
      await updateConfig({ autostart: false });
      console.log('Autostart skipped.');
    }
    const listener = startListenerNow();
    console.log(listener.message);
  } finally {
    prompt.close();
  }
  await showStatus();
}

async function selectProvider(prompt = createPrompt()) {
  try {
    const provider = await prompt.choose('Select provider:', providers) as Provider;
    const key = await prompt.ask(`Paste ${provider} API key: `);
    const verification = await verifyProviderKey(provider, key);
    console.log(verification.message);
    await updateConfig({ provider, keys: key ? { [provider]: key } : undefined });
    console.log(`Provider set to ${provider}.`);
  } finally {
    if (arguments.length === 0) prompt.close();
  }
}

async function selectModel(prompt = createPrompt()) {
  try {
    const labels = modelOptions.map((option) => option.label);
    const label = await prompt.choose('Select model:', labels);
    const option = modelOptions.find((candidate) => candidate.label === label) as ModelOption;
    const key = await prompt.ask(`Paste ${option.provider} API key: `);
    const verification = await verifyProviderKey(option.provider, key);
    console.log(verification.message);
    await updateConfig({
      provider: option.provider,
      model: option.model,
      keys: key ? { [option.provider]: key } : undefined
    });
    console.log(`Model set to ${option.label}.`);
  } finally {
    if (arguments.length === 0) prompt.close();
  }
}

async function setShortcut(allowDefault = false, prompt = createPrompt()) {
  try {
    const answer = await prompt.ask(`Shortcut${allowDefault ? ` [${defaultShortcut}]` : ''}: `);
    const shortcut = answer || defaultShortcut;
    await updateConfig({ shortcut });
    console.log(`Shortcut set to ${shortcut}.`);
  } finally {
    if (arguments.length < 2) prompt.close();
  }
}

async function showStatus() {
  const config = await loadConfig();
  console.log('Current setup:');
  console.log(`  Provider: ${config.provider || 'not set'}`);
  console.log(`  Model: ${config.model || 'not set'}`);
  console.log(`  Shortcut: ${config.shortcut || 'not set'}`);
  console.log(`  API key: ${config.provider && config.keys?.[config.provider] ? 'saved' : 'not set'}`);
  console.log(`  Autostart: ${config.autostart ? 'enabled' : 'not enabled'}`);
}

async function listen() {
  const config = await loadConfig();
  console.log('Wisper listener running.');
  console.log(`Provider: ${config.provider || 'not set'}`);
  console.log(`Model: ${config.model || 'not set'}`);
  console.log(`Shortcut: ${config.shortcut || defaultShortcut}`);
  console.log('Waiting for shortcut. Recording/hotkey engine is the next implementation step. Press Ctrl+C to stop.');
  await new Promise(() => undefined);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
