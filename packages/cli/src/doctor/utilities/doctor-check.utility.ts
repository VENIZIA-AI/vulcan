import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { IViolation, TDoctorCheck } from '../common/types.ts';

/** What the doctor checks share: building a violation and reading the files of a project. */
export class DoctorCheckUtility {
  static createViolation(opts: { check: TDoctorCheck; file: string; message: string }): IViolation {
    return {
      check: opts.check,
      file: opts.file,
      message: opts.message,
    };
  }

  static readText(opts: { file: string }): string {
    return existsSync(opts.file) ? readFileSync(opts.file, 'utf8') : '';
  }

  static listDirectories(opts: { directory: string }): string[] {
    return existsSync(opts.directory)
      ? readdirSync(opts.directory, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
      : [];
  }

  static readJsonObject(opts: { file: string }): Record<string, unknown> | undefined {
    try {
      const value: unknown = JSON.parse(readFileSync(opts.file, 'utf8'));

      return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value))
        : undefined;
      // eslint-disable-next-line venizia/no-silent-catch -- undefined is the unreadable answer each doctor check reports in its own words
    } catch {
      return undefined;
    }
  }
}
