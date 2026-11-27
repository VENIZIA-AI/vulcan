// A developer or an agent session may launch with `VULCAN_GUARD_ASKS=deny` (or another `VULCAN_GUARD*` choice), and the guards a
// test starts would obey it. Every test begins without them and sets the ones it is about.
for (const name of Object.keys(process.env)) {
  if (name.startsWith('VULCAN_GUARD')) {
    delete process.env[name];
  }
}
