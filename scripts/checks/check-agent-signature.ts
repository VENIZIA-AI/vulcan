/**
 * W-00 as a check: a commit message never signs the commit as an agent.
 *
 * `check-agent-signature.ts <message-file>` is the git `commit-msg` hook (git passes the file); `--range
 * <revs>` checks every commit of a range (CI); `--text <message>` checks one message. A signature is a
 * `Co-Authored-By` or `Signed-off-by` trailer that names an agent or its vendor, or a "generated with/by"
 * line that does. A tool named in a subject ("fix the Claude settings merge") is not a signature, and a
 * human co-author is not either.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const AGENT =
  /claude|anthropic|openai|chatgpt|\bgpt[-\d]|codex|copilot|gemini|cursor|\bagent\b|\bai\b|\bbot\b/i;
const TRAILER = /^\s*(co-authored-by|signed-off-by)\s*:\s*(.*)$/i;
const GENERATED = /^\s*(?:\p{Extended_Pictographic}\s*)?generated\s+(?:with|by)\b(.*)$/iu;

export interface ISignature {
  line: number;
  text: string;
}

/** The lines of `message` that sign it as an agent; git's own `#` comment lines are not part of a message. */
export const signaturesOf = (opts: { message: string }): ISignature[] =>
  opts.message.split('\n').flatMap((text, index) => {
    if (text.startsWith('#')) {
      return [];
    }

    const trailer = TRAILER.exec(text);
    const generated = GENERATED.exec(text);
    const isSigned =
      (trailer !== null && AGENT.test(trailer[2])) ||
      (generated !== null && (AGENT.test(generated[1]) || /^\s*\[/.test(generated[1])));

    return isSigned ? [{ line: index + 1, text: text.trim() }] : [];
  });

const describe = (opts: { label: string; found: ISignature[] }): string[] =>
  opts.found.map(
    (hit) =>
      `  ${opts.label} line ${hit.line}: "${hit.text}" signs the commit as an agent (W-00); remove the line`,
  );

const rangeCommits = (opts: { range: string }): { id: string; message: string }[] => {
  const result = spawnSync('git', ['log', '--format=%h%x01%B%x00', opts.range], {
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(`git log ${opts.range} failed: ${result.stderr.trim()}`);
  }

  return result.stdout
    .split('\x00')
    .map((chunk) => chunk.replace(/^\n/, ''))
    .filter((chunk) => chunk.trim() !== '')
    .map((chunk) => {
      const [id, ...rest] = chunk.split('\x01');

      return { id, message: rest.join('\x01') };
    });
};

const main = (): number => {
  const args = process.argv.slice(2);
  const problems: string[] = [];

  if (args[0] === '--range' && args[1] !== undefined) {
    for (const commit of rangeCommits({ range: args[1] })) {
      problems.push(
        ...describe({
          label: `commit ${commit.id},`,
          found: signaturesOf({ message: commit.message }),
        }),
      );
    }
  } else if (args[0] === '--text' && args[1] !== undefined) {
    problems.push(...describe({ label: 'message,', found: signaturesOf({ message: args[1] }) }));
  } else if (args[0] !== undefined && !args[0].startsWith('--')) {
    problems.push(
      ...describe({
        label: 'commit message,',
        found: signaturesOf({ message: readFileSync(args[0], 'utf8') }),
      }),
    );
  } else {
    console.error(
      'usage: check-agent-signature.ts <message-file> | --range <revs> | --text <message>',
    );

    return 2;
  }

  if (problems.length > 0) {
    console.error(
      `agent-signature: ${problems.length} line(s) sign a commit as an agent - W-00 allows none:\n${problems.join('\n')}`,
    );

    return 1;
  }

  return 0;
};

if (import.meta.main) {
  process.exit(main());
}
