/**
 * A package.json as `bun fmt` wants it. The text goes through `bun fmt --stdin-filepath`, so the
 * key order is Bun's own (name, version, ... scripts, dependencies A to Z) and `bun fmt --check`
 * is green right after VULCAN writes the file; a copy of that order here would drift. `--no-script`
 * keeps a `fmt` script from taking over. Bun is the runtime (`engines`), so `process.execPath` is it.
 * When bun fmt fails the unsorted text is returned and the reason printed: `make lint` flags the file.
 */
export const renderManifestJson = (opts: { value: unknown }): string => {
  const text = `${JSON.stringify(opts.value, null, 2)}\n`;
  const result = Bun.spawnSync(
    [process.execPath, 'fmt', '--no-script', '--stdin-filepath', 'package.json'],
    { stdin: Buffer.from(text), stdout: 'pipe', stderr: 'pipe' },
  );

  if (result.exitCode !== 0) {
    console.error(
      `[renderManifestJson] bun fmt exited ${result.exitCode}, the package.json is left unsorted | ${result.stderr.toString().trim()}`,
    );

    return text;
  }

  return result.stdout.toString();
};
