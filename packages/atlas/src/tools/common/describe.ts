/** What a description names when the server was not told which projects it serves. */
const FALLBACK_PROJECTS = 'the projects atlas serves';

/**
 * A tool description opens with when to call the tool, then says what it returns: an agent picks a
 * tool by its description alone, and a description that only says what it returns never fires.
 */
export class ToolTriggers {
  static symbol(opts: { projects?: string }): string {
    return `Before you import or call an export of ${opts.projects ?? FALLBACK_PROJECTS}, get its real signature, import path and source line here instead of recalling it.`;
  }

  static search(opts: { projects?: string }): string {
    return `When the user asks how something works in ${opts.projects ?? FALLBACK_PROJECTS}, or about this project's conventions, search here before you answer from memory.`;
  }

  static presets(opts: { projects?: string }): string {
    return `When you are asked to create a new app or package in ${opts.projects ?? FALLBACK_PROJECTS}, ask here which preset and which exact command to use before you write any file.`;
  }

  static get(): string {
    return 'After `search`, read the hit here before you rely on it.';
  }

  static version(opts: { projects?: string }): string {
    return `When a version, an upgrade or an installed @venizia/* package comes up in ${opts.projects ?? FALLBACK_PROJECTS}, check here.`;
  }

  static changes(opts: { projects?: string }): string {
    return `When the user asks what changed, what a release added or what breaks on upgrade in ${opts.projects ?? FALLBACK_PROJECTS}, list the entries here.`;
  }
}
