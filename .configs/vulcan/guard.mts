import type { VulcanConfig } from '@venizia/vulcan';

// The release path is the owner's: an agent does not approve a waiting deployment or write a secret, an environment, a
// ruleset, a branch protection, a collaborator role or the Actions permissions (rule W-08). A write to one of these through
// `gh api` is an explicit -X POST, PUT, PATCH or DELETE or any body flag (gh turns -f, -F, --field, --raw-field and --input
// into a POST); a read of the same endpoints asks nothing. Guards ask (guard-outside denies), and they are not a sandbox.
export const guard = {
  // A write outside the project (V-B-08) is refused, not asked about (`outside: 'deny'`, from the venizia pack): an ask interrupts the owner, or is approved unseen in an auto mode.
  writes: {
    commands: [
      {
        rule: 'V-W-03',
        what: 'writing a GitHub environment, secret, ruleset, protection or permission, or approving a deployment',
        pattern:
          '\\bgh\\s+api\\b(?=[^\\n]*\\b(?:environments|actions/secrets|actions/variables|actions/permissions|rulesets|branches/\\S+/protection|collaborators|pending_deployments)\\b)(?=[^\\n]*\\s(?:-X\\s*(?:POST|PUT|PATCH|DELETE)|-f|-F|--field|--raw-field|--input)\\b)',
        ignoreCase: true,
      },
      {
        rule: 'V-W-03',
        what: 'writing a GitHub Actions secret or variable',
        pattern: '\\bgh\\s+(?:secret|variable)\\s+(?:set|delete|remove)\\b',
      },
    ],
  },
} satisfies NonNullable<VulcanConfig.Guard>;
