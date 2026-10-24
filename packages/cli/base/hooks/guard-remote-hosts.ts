/**
 * PreToolUse hook on Bash: asks before a command reaches a host the project has not listed in
 * `remoteHosts` (trusted, or readOnly for the strict read-only forms). The policy is read from the
 * committed manifest, `.agents/vulcan.manifest.json`, plus the personal list `remoteHosts.localFile`.
 *
 * It fails closed: Claude Code blocks a PreToolUse call only on exit 2, so every error here - a missing
 * module, a manifest without the policy - exits 2. The modules load inside the try for that reason.
 */

// A module, so the awaits below are top-level; it has no static import, by design.
export {};

try {
  const { buildRemoteDecision, inspectRemoteCommand, parseTrustedList } =
    await import('../../src/hooks/remote-hosts.ts');
  const { parseHookCommand } = await import('../../src/hooks/guard-writes.ts');
  const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const manifestFile = Bun.file(`${root}/.agents/vulcan.manifest.json`);

  if (!(await manifestFile.exists())) {
    throw new Error('.agents/vulcan.manifest.json is missing - run vulcan sync');
  }

  const manifest = await manifestFile.json();
  const remoteHosts = manifest?.remoteHosts;

  if (typeof remoteHosts !== 'object' || remoteHosts === null) {
    throw new Error('the manifest has no remoteHosts - run vulcan sync');
  }

  const localFile = typeof remoteHosts.localFile === 'string' ? remoteHosts.localFile : undefined;
  const local = localFile === undefined ? undefined : Bun.file(`${root}/${localFile}`);
  const personal = local !== undefined && (await local.exists()) ? await local.text() : '';
  const trusted: string[] = Array.isArray(remoteHosts.trusted) ? remoteHosts.trusted : [];
  const readOnly: string[] = Array.isArray(remoteHosts.readOnly) ? remoteHosts.readOnly : [];
  const hookCommand = parseHookCommand({ text: await Bun.stdin.text() });
  const hits = hookCommand
    ? inspectRemoteCommand({
        command: hookCommand.command,
        policy: {
          trusted: [...trusted, ...parseTrustedList({ text: personal })],
          readOnly,
          ...(localFile === undefined ? {} : { localFile }),
        },
      })
    : [{ rule: 'remote-hosts', message: 'the hook input could not be read' }];

  if (hits.length > 0) {
    console.log(JSON.stringify(buildRemoteDecision({ hits })));
  }
} catch (error) {
  console.error(
    `vulcan: the guard-remote-hosts hook failed (${error instanceof Error ? error.message : String(error)}) - blocked`,
  );
  process.exit(2);
}
