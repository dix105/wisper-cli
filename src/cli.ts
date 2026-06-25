#!/usr/bin/env node
import { loadHistory, saveTranscript } from './storage.js';
import { startWebApp } from './server.js';
import { openUrl } from './open.js';

const [command, ...args] = process.argv.slice(2);

async function main() {
  switch (command) {
    case undefined:
    case 'help':
      printHelp();
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
  wisper app              Open local web app
  wisper open             Alias for app
  wisper history [limit]  Print transcript history
  wisper add "text"       Save a manual transcript
  wisper help             Show help
`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
