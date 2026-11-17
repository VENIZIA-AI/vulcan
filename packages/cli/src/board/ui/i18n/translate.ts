import type { TBoardLanguage } from '../common/types.ts';
import { DICTIONARY } from './dictionary.ts';

/** The words of the page. Vietnamese is the source text, so its dictionary only overrides; a key with no entry is its own text. */
export class BoardI18n {
  static translate(opts: { language: TBoardLanguage; key: string }): string {
    return DICTIONARY[opts.language][opts.key] ?? opts.key;
  }
}
