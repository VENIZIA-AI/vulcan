/**
 * What every hook command runs the bundle through: a few lines of `bun -e` that hash the bundle file, compare the hash with the one in the
 * manifest at `HEAD` (`git show`, so a file in the working tree is not trusted), and only then import the file. A bundle that is not
 * the one the committed manifest records, a manifest with no entry for it, no git or no commit: exit 97, and the wrapper blocks.
 * New sums reach `HEAD` only when the owner syncs and commits; a commit that changes them asks.
 */
export class BundleLoader {
  /** The exit code of a bundle that was refused: the wrappers block on it instead of asking, as they would for a crash. */
  static readonly REFUSED = 97;
  /** The variables the script reads: the bundle file and the project root. */
  static readonly FILE_VARIABLE = 'VULCAN_HOOK_FILE';
  static readonly ROOT_VARIABLE = 'VULCAN_HOOK_ROOT';

  /** The script, with no single quote in it so a shell can hold it in single quotes. */
  static readonly SCRIPT = [
    'const fs = require("node:fs"), cp = require("node:child_process"), c = require("node:crypto");',
    'const f = process.env.VULCAN_HOOK_FILE ?? "", root = process.env.VULCAN_HOOK_ROOT ?? "", name = f.split("/").pop() ?? "";',
    'let want;',
    'try { const g = cp.spawnSync("git", ["-C", root, "show", "HEAD:./.agents/vulcan.manifest.json"], { encoding: "utf8", timeout: 10000 });',
    'const m = JSON.parse(g.stdout); const s = m && m.hooks && m.hooks.sha256; want = s && typeof s[name] === "string" ? s[name] : undefined; } catch {}',
    'let got; try { got = c.createHash("sha256").update(fs.readFileSync(f)).digest("hex"); } catch {}',
    'if (want === undefined || want !== got) {',
    'console.error("vulcan: the hook " + name + " is not the one the manifest at HEAD records (hooks.sha256), or there is no git or no committed manifest: the owner runs bun node_modules/.bin/vulcan sync and commits the manifest, outside the agent session");',
    'process.exit(97); }',
    'await import(f);',
  ].join(' ');

  /** The shell words that run the file in `$f` through the script, for a wrapper whose project root is `root` (a shell expression). */
  static shellRun(opts: { root: string }): string {
    return `export ${BundleLoader.FILE_VARIABLE}="$f" ${BundleLoader.ROOT_VARIABLE}="${opts.root}";`;
  }

  /** The command that runs it: `bun` with the flags of every hook and the script in single quotes. */
  static readonly BUN_COMMAND = `bun --no-env-file --config=/dev/null -e '${BundleLoader.SCRIPT}'`;
}
