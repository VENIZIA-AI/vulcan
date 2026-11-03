import type { ICommentStyle, ICommitSubject, ISubjectProblem } from './common/index.ts';
import { CommitMessage } from './message.ts';

const GENERATED_SUBJECT = /^(?:Merge |Revert "|(?:fixup|squash|amend)! )/;

export class SubjectShape {
  static problemOf(opts: {
    message: string;
    subject: ICommitSubject;
    comment?: ICommentStyle;
  }): ISubjectProblem | undefined {
    const lines = CommitMessage.linesOf({ message: opts.message, comment: opts.comment });
    const index = lines.findIndex(
      (text) =>
        text.trim() !== '' && !CommitMessage.isComment({ line: text, comment: opts.comment }),
    );

    if (index === -1) {
      return undefined;
    }

    const text = lines[index].trim();

    if (GENERATED_SUBJECT.test(text) || new RegExp(opts.subject.pattern).test(text)) {
      return undefined;
    }

    return { line: index + 1, text, hint: opts.subject.hint };
  }

  static patternError(opts: { pattern: string }): string | undefined {
    try {
      new RegExp(opts.pattern);

      return undefined;
    } catch (error) {
      return `not a regular expression: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}
