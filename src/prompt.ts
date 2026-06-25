import { createInterface, type Interface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { readFileSync } from 'node:fs';

export type Prompt = {
  ask(question: string): Promise<string>;
  choose(label: string, options: string[]): Promise<string>;
  close(): void;
};

export function createPrompt(): Prompt {
  if (!input.isTTY) {
    const lines = readFileSync(0, 'utf8').split(/\r?\n/);
    let index = 0;
    const next = () => (lines[index++] || '').trim();
    return {
      async ask(question: string) {
        output.write(question);
        return next();
      },
      async choose(label: string, options: string[]) {
        console.log(label);
        options.forEach((option, optionIndex) => console.log(`  ${optionIndex + 1}. ${option}`));
        output.write('Choose number: ');
        const choice = Number(next()) - 1;
        if (!options[choice]) throw new Error('Invalid choice');
        return options[choice];
      },
      close() {}
    };
  }

  const rl: Interface = createInterface({ input, output });
  return {
    async ask(question: string) {
      return (await rl.question(question)).trim();
    },
    async choose(label: string, options: string[]) {
      console.log(label);
      options.forEach((option, index) => console.log(`  ${index + 1}. ${option}`));
      const answer = await rl.question('Choose number: ');
      const index = Number(answer.trim()) - 1;
      if (!options[index]) throw new Error('Invalid choice');
      return options[index];
    },
    close() {
      rl.close();
    }
  };
}
