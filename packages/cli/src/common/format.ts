/**
 * `text` as `bun fmt` formats the file named `opts.file` (only the extension and name matter: the
 * text goes in on stdin). A file VULCAN writes this way is what `bun fmt --check` accepts, so a
 * regenerate never turns lint red, and no copy of Bun's rules (key order, array layout) lives here.
 * `--no-script` keeps a `fmt` script from taking over. Bun is the runtime (`engines`), so
 * `process.execPath` is it. When bun fmt fails the text comes back unchanged and the reason is
 * printed: `make lint` flags the file.
 */
export const formatWithBun = (opts: { text: string; file: string }): string => {
  const result = Bun.spawnSync(
    [process.execPath, 'fmt', '--no-script', '--stdin-filepath', opts.file],
    { stdin: Buffer.from(opts.text), stdout: 'pipe', stderr: 'pipe' },
  );

  if (result.exitCode !== 0) {
    console.error(
      `[formatWithBun] bun fmt exited ${result.exitCode}, ${opts.file} is left as rendered | ${result.stderr.toString().trim()}`,
    );

    return opts.text;
  }

  return result.stdout.toString();
};
