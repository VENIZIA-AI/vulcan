import { ExitCodes } from '../../common/index.ts';

/** How `vulcan add` (an app or a library) reports a refusal: one line on stderr and the failure exit code. */
export class AddFailure {
  static fail(opts: { message: string }): number {
    process.stderr.write(`vulcan add: ${opts.message}\n`);

    return ExitCodes.FAILURE;
  }
}
