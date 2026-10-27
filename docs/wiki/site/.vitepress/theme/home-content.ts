/**
 * Every word of VULCAN's home page and footer. The structure, the design and the behaviour are the
 * shared layout (theme/shared); this file only says what it shows.
 *
 * COUNTS is what the page claims about the shipped files. A test of the wiki
 * (scripts/checks/__tests__/wiki-intro-counts.test.ts) counts the same things from the repository and
 * fails when a number here drifts, so update COUNTS and the test passes again.
 */
import pkg from '../../../../../packages/cli/package.json';
import type { THomeContent, TSiteInfo } from './shared/home-types';

export const COUNTS = { rules: 50, skills: 12, agents: 7, tools: 6 };

export const SITE: TSiteInfo = {
  id: 'vulcan',
  name: 'VULCAN',
  repo: 'https://github.com/VENIZIA-AI/vulcan',
  npm: 'https://www.npmjs.com/package/@venizia/vulcan',
  own: [
    ['Guide', '/guides/'],
    ['References', '/references/'],
    ['Commands', '/references/commands/'],
    ['Changelog', '/changelogs/'],
  ],
};

export const VERSION: string = pkg.version;

export const HOME: THomeContent = {
  id: 'vulcan',
  name: 'VULCAN',
  version: VERSION,
  eyebrow: `VULCAN ${VERSION} · MIT · Bun 1.4.4+`,
  title: [['Guide your coding agents.'], 'VULCAN forges the contract.'],
  lede: 'One config gives every agent in the repository the same rules, skills and project knowledge, and its guards stop a force-push to main.',
  ledeNote:
    'Guards are checked in Claude Code, omp, pi and Antigravity; Codex, Cursor and Copilot are not verified yet.',
  install: {
    label: 'Install',
    lines: ['bun add -d --exact @venizia/vulcan', 'bun x --no-install vulcan init'],
  },
  cta: [
    ['Get started', '/guides/get-started/what-is-vulcan'],
    ['References', '/references/'],
  ],
  tabs: [
    {
      file: 'an agent pushes',
      kind: 'term',
      body: [
        ['cmd', 'git push --force origin main'],
        ['c', '# guard-git, a PreToolUse hook, answers before git runs'],
        ['verdict', 'permissionDecision: deny'],
        ['gap', ''],
        ['out', 'permissionDecisionReason:'],
        ['bad', '  This command is refused by the base rules:'],
        ['bad', "    - V-W-06: force-pushing to 'main'"],
        ['gap', ''],
        ['out', '  Hand the exact command to the owner instead (V-W-06);'],
        ['out', '  VULCAN_GUARDS=off switches the guards off for a session.'],
      ],
      note: 'What an agent sees when it runs a force-push to <code>main</code>: the hook\'s JSON answer, rendered. <a href="/guides/core-concepts/hooks-and-guards">The guards are not a sandbox.</a>',
    },
    {
      file: '.configs/vulcan.config.mts',
      kind: 'code',
      body: `import type { VulcanConfig } from '@venizia/vulcan';

export default {
  agents: ['claude', 'omp'],
  rules: { 'V-W-01': 'on-user-word' },
  remoteHosts: {
    trusted: ['lab1'],
    readOnly: ['prod1'],
  },
  guard: {
    writes: { trustedScripts: ['tools/i18n/cli.ts'] },
  },
} satisfies VulcanConfig;`,
      note: 'The config of a project. <a href="/references/configuration/">Every key is in the reference.</a>',
    },
    {
      file: 'vulcan sync',
      kind: 'term',
      body: [
        ['cmd', 'bun x --no-install vulcan sync --agents claude'],
        ['ok', '  created   CLAUDE.md'],
        [
          'ok',
          '  created   .claude/settings.json (shipped, slot, project hooks and claude.settings over personal keys)',
        ],
        ['ok', '  created   .claude/skills/build-a-feature'],
        ['c', '  ... 11 more skills'],
        ['gap', ''],
        ['ok', '  created   .mcp.json'],
        ['ok', '  created   .agents/vulcan.manifest.json'],
        [
          'ok',
          '  created   .agents/local (created tmp, worktrees, clones, cache, reports, prototypes)',
        ],
      ],
      note: 'Real output of <code>vulcan sync</code> on a new project, trimmed.',
    },
  ],
  stats: [
    [String(COUNTS.rules), 'base rules'],
    [String(COUNTS.skills), 'skills'],
    [String(COUNTS.agents), 'coding agents'],
    [String(COUNTS.tools), 'atlas tools'],
  ],
  footnote:
    'Counted from the shipped files. A test of the wiki fails when the numbers it states drift from them.',
  featuresTitle: 'What it offers today',
  featuresLede: 'Eight parts, each with a page that says what it does and what it does not.',
  cells: [
    {
      name: 'rules',
      title: 'Base rules',
      text: `${COUNTS.rules} rules in five groups: write boundaries, security, process, build and style. The agent reads them at session start. Most are advice; a few are enforced by hooks.`,
      href: '/guides/core-concepts/rules-and-slots',
      chip: ['Soft and hard', ''],
    },
    {
      name: 'guards',
      title: 'Guards that ask',
      text: 'Hooks that ask or refuse before a database write, a deploy, a force-push or a file outside the project. Not a sandbox. Your own CLIs can be listed as trusted.',
      href: '/guides/core-concepts/hooks-and-guards',
      chip: ['3 agents not verified', 'no'],
    },
    {
      name: 'skills',
      title: 'Skills',
      text: `${COUNTS.skills} workflows an agent loads when the task fits: plan, build, fix, review, report, ship, research, retro and docs.`,
      href: '/references/skills',
    },
    {
      name: 'owner',
      title: 'Replies that follow the reader',
      text: 'The owner gets a fixed reply shape in their own language; another agent gets the plain format it asked for.',
      href: '/guides/core-concepts/owner-and-replies',
    },
    {
      name: 'work items',
      title: 'Work items',
      text: 'A template for a unit of work a person can read and a fresh agent can do. VULCAN ships the format, not a tracker.',
      href: '/guides/core-concepts/work-items',
    },
    {
      name: 'okf',
      title: 'Knowledge bundle',
      text: 'Markdown facts about your project, checked in Open Knowledge Format v0.2, with a graph viewer.',
      href: '/guides/core-concepts/knowledge-bundle',
    },
    {
      name: 'atlas',
      title: 'Search with atlas',
      text: `An MCP server with ${COUNTS.tools} tools that searches your docs, changelogs and symbols, and those of other projects.`,
      href: '/guides/core-concepts/atlas',
    },
    {
      name: 'doctor',
      title: 'One check',
      text: 'vulcan doctor checks that the repository follows the contract; vulcan sync keeps every agent file current after an upgrade.',
      href: '/references/commands/doctor',
    },
  ],
  extraHtml: `<section class="section section--soft" id="agents"><div class="wrap">
    <div class="sec-head reveal"><div class="eyebrow"><i></i>Honest about maturity</div>
      <h2>Which agents are guarded, <span class="dim">and how far that was checked.</span></h2>
      <p>VULCAN sets up seven coding agents. The guards run on all of them; what has been run is below. NOT VERIFIED means built from the agent's documentation and unit tests, and never run in that agent.</p></div>
    <div class="table-scroll reveal"><table class="status"><thead><tr><th>Agent</th><th>How the guards run</th><th>Checked</th></tr></thead><tbody>
      <tr><td>Claude Code</td><td>hooks in <code>.claude/settings.json</code></td><td><span class="chip chip--ok">Real sessions</span></td></tr>
      <tr><td>omp</td><td><code>.omp/hooks/pre/vulcan-guards.ts</code>, written by <code>vulcan sync</code></td><td><span class="chip chip--ok">Real model, omp 18.8.9</span></td></tr>
      <tr><td>pi</td><td><code>.pi/extensions/vulcan-guards.ts</code>; pi asks you to trust the project first</td><td><span class="chip">SDK, scripted provider</span></td></tr>
      <tr><td>Antigravity</td><td>an entry in <code>.agents/hooks.json</code></td><td><span class="chip">agy 1.4.7: a deny holds</span></td></tr>
      <tr><td>Codex</td><td><code>.codex/hooks.json</code>; trust it in <code>/hooks</code>; an ask is shown as a deny</td><td><span class="chip chip--no">Not verified</span></td></tr>
      <tr><td>Cursor</td><td>reads the Claude hooks of <code>.claude/settings.json</code></td><td><span class="chip chip--no">Not verified</span></td></tr>
      <tr><td>Copilot</td><td>reads the Claude hooks of <code>.claude/settings.json</code></td><td><span class="chip chip--no">Not verified</span></td></tr>
    </tbody></table></div></div></section>`,
  stepsTitle: 'Three commands',
  steps: [
    {
      title: 'Init',
      text: 'Writes the project layer: rules, knowledge index, config, Makefile. It never overwrites.',
      lines: [
        ['cmd', 'bun x --no-install vulcan init'],
        ['ok', '  created  AGENTS.md'],
        ['ok', '  created  .agents/rules.md'],
        ['ok', '  created  .configs/vulcan.config.mts'],
        ['c', '  ...'],
      ],
    },
    {
      title: 'Sync',
      text: 'Writes what your agents read: adapters, skills, hooks, the atlas entry, the manifest.',
      lines: [
        ['cmd', 'bun x --no-install vulcan sync'],
        ['ok', '  created   .claude/settings.json'],
        ['ok', '  created   .mcp.json'],
        ['ok', '  created   .agents/vulcan.manifest.json'],
        ['c', '  ...'],
      ],
    },
    {
      title: 'Doctor',
      text: 'Checks the result. Exit code 1 on any violation, so it also runs in CI.',
      lines: [
        ['cmd', 'bun x --no-install vulcan doctor'],
        ['ok', 'vulcan doctor: OK'],
      ],
    },
  ],
  fitUse: [
    'A repository that coding agents work in',
    'You want the same rules and guards in every project',
    'You want an agent to ask before it touches a database, a cluster or a protected branch',
    'You use Claude Code, omp, pi, Antigravity, Codex, Cursor or Copilot',
  ],
  fitNot: [
    'Running, building or deploying your code: VULCAN does none of it',
    'A sandbox: a guard stops accidental commands, not a determined one',
    'A tracker: work items are a format, readiness stays in your tracker',
    'A 1.0 contract: it is on the 0.4 line',
  ],
  maturityHtml:
    '<b>On the 0.4 line.</b> The config schema and the commands still change between releases, and every release is a patch release, breaking ones included. Each changelog entry says who is affected and what to do. Run <code>vulcan sync</code> after every upgrade.',
  closing: {
    title: 'Put your agents on the same page.',
    text: 'Add one devDependency, run three commands, and every agent in the repository reads the same rules.',
  },
};
