/**
 * PreToolUse hook on Bash: asks before a command reaches a host the project has not listed in
 * `remoteHosts` (trusted, or readOnly for the strict read-only forms). The policy is read from the
 * committed manifest, `.agents/vulcan.manifest.json`, plus the personal list `remoteHosts.localFile`: one host per
 * line is trusted, `readonly: <host>` is a read-only host, and a line that is not a host name or a `*` pattern is
 * skipped (said once on stderr) and never trusted.
 *
 * It fails closed: Claude Code blocks a PreToolUse call only on exit 2, so every error here - a missing
 * module, a manifest without the policy - exits 2. The modules load inside the try for that reason.
 */

// A module, so the awaits below are top-level; it has no static import, by design.
export {};

try {
  const { RemoteHosts } = await import('../../src/hooks/remote-hosts.ts');
  const { WriteGuard } = await import('../../src/hooks/guard-writes.ts');
  const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const manifestFile = Bun.file(`${root}/.agents/vulcan.manifest.json`);

  const manifestExists = await manifestFile.exists();

  if (!manifestExists) {
    throw new Error('.agents/vulcan.manifest.json is missing - run vulcan sync');
  }

  const manifest = await manifestFile.json();
  const remoteHosts = manifest?.remoteHosts;

  if (typeof remoteHosts !== 'object' || remoteHosts === null) {
    throw new Error('the manifest has no remoteHosts - run vulcan sync');
  }

  const localFile = typeof remoteHosts.localFile === 'string' ? remoteHosts.localFile : undefined;
  const local = localFile === undefined ? undefined : Bun.file(`${root}/${localFile}`);
  const localExists = await local?.exists();
  const readingPersonal = localExists === true ? local?.text() : undefined;
  const personalText = await readingPersonal;
  const personal = RemoteHosts.parsePersonalList({ text: personalText ?? '' });
  const trusted: string[] = Array.isArray(remoteHosts.trusted) ? remoteHosts.trusted : [];
  const readOnly: string[] = Array.isArray(remoteHosts.readOnly) ? remoteHosts.readOnly : [];
  const stdin = await Bun.stdin.text();

  if (personal.skipped.length > 0) {
    console.error(
      `vulcan: the guard-remote-hosts hook skipped lines ${personal.skipped.join(', ')} of ${localFile}: not a host name or a * pattern, so they trust nothing`,
    );
  }

  const hookCommand = WriteGuard.parseHookCommand({ text: stdin });
  const hits = hookCommand
    ? RemoteHosts.inspectCommand({
        command: hookCommand.command,
        policy: {
          trusted: [...trusted, ...personal.trusted],
          readOnly: [...readOnly, ...personal.readOnly],
          ...(localFile === undefined ? {} : { localFile }),
        },
      })
    : [{ rule: 'remote-hosts', message: 'the hook input could not be read' }];

  if (hits.length > 0) {
    console.log(JSON.stringify(RemoteHosts.buildDecision({ hits })));
  }
} catch (error) {
  console.error(
    `vulcan: the guard-remote-hosts hook failed (${error instanceof Error ? error.message : String(error)}) - blocked`,
  );
  process.exit(2);
}
