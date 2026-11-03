import { TextValue } from '../common/index.ts';
import type { ICommitAgents, ISignatureHit } from './common/index.ts';
import { CommitMessage } from './message.ts';

/** Any `*-by:` trailer: Co-authored-by, Signed-off-by, Co-developed-by, Assisted-by, Reviewed-by. */
const TRAILER = /^\s*[A-Za-z][A-Za-z-]*-by\s*:\s*(.*)$/i;
const ADDRESS = /<([^>]+)>/;
/** `noreply`, `no-reply`, `no_reply`, or GitHub's `<id>+noreply`: the local part of an address no person reads. */
const NOREPLY_LOCAL = /^(?:\d+\+)?no[-_]?reply$/i;
const LEADING_PICTOGRAPH = /^\s*(?:\p{Extended_Pictographic}\s*)?/u;

export class AgentSignature {
  static find(opts: { message: string; agents: ICommitAgents }): ISignatureHit[] {
    const mention = new RegExp(
      `(?<![A-Za-z0-9])(?:${opts.agents.mentions.map((text) => TextValue.escapeLiteral({ text })).join('|')})(?![A-Za-z0-9])`,
      'i',
    );

    return CommitMessage.linesOf({ message: opts.message }).flatMap((raw, index) => {
      const text = CommitMessage.cleanOf({ text: raw });

      if (text.startsWith('#')) {
        return [];
      }

      const isSigned =
        AgentSignature.isSigningTrailer({ text, agents: opts.agents }) ||
        AgentSignature.isGeneratedLine({ text, mention, agents: opts.agents });

      return isSigned ? [{ line: index + 1, text: raw.trim() }] : [];
    });
  }

  private static isSigningTrailer(opts: { text: string; agents: ICommitAgents }): boolean {
    const value = TRAILER.exec(opts.text)?.[1];

    if (value === undefined) {
      return false;
    }

    const address = ADDRESS.exec(value)?.[1] ?? '';
    const display = value.replace(ADDRESS, ' ');
    const whole = CommitMessage.compactOf({ text: value });

    if (opts.agents.allow.some((name) => whole.includes(CommitMessage.compactOf({ text: name })))) {
      return false;
    }

    const name = CommitMessage.compactOf({ text: display });

    return (
      opts.agents.products.some((product) =>
        name.startsWith(CommitMessage.compactOf({ text: product })),
      ) || AgentSignature.isAgentAddress({ address, agents: opts.agents })
    );
  }

  private static isAgentAddress(opts: { address: string; agents: ICommitAgents }): boolean {
    const at = opts.address.lastIndexOf('@');

    if (at === -1) {
      return false;
    }

    const local = opts.address.slice(0, at);
    const domain = opts.address.slice(at + 1).toLowerCase();
    const bare = local.replace(/^\d+\+/, '').toLowerCase();

    return (
      opts.agents.addressNames.some((name) => name.toLowerCase() === bare) ||
      (NOREPLY_LOCAL.test(local) &&
        opts.agents.noreplyDomains.some(
          (listed) => domain === listed || domain.endsWith(`.${listed}`),
        ))
    );
  }

  /** Only at the start of a line, and only when it names an agent: "Generated with protoc" is a human's note. */
  private static isGeneratedLine(opts: {
    text: string;
    mention: RegExp;
    agents: ICommitAgents;
  }): boolean {
    const body = opts.text.replace(LEADING_PICTOGRAPH, '');
    const lower = body.toLowerCase();
    const phrase = opts.agents.generatedPhrases.find((listed) => lower.startsWith(listed));

    return phrase !== undefined && opts.mention.test(body.slice(phrase.length));
  }
}
