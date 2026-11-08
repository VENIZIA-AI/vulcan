import { afterAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { WriteGuard } from '../../hooks/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { SPAWN_TIMEOUT_MS } from '@venizia/dev-configs/testing';

afterAll(removeProjects);

const HOOK = join(import.meta.dir, '..', '..', '..', 'base', 'hooks', 'guard-writes.ts');

describe('a shell that reads its commands from stdin, and find -exec, are followed', () => {
  test.each([
    'bash <<< "kubectl apply -f x.yaml"',
    "printf 'kubectl apply -f x.yaml' | sh",
    'find . -name x -exec kubectl apply -f {} +',
  ])('%s asks', (command) => {
    expect(WriteGuard.inspectCommand({ command }).length).toBeGreaterThan(0);
  });

  test.each(['bash <<< "ls"', "printf 'ls' | sh", 'find . -name x -exec grep -l foo {} +'])(
    '%s stays quiet',
    (command) => {
      expect(WriteGuard.inspectCommand({ command })).toEqual([]);
    },
  );
});

/** The real hook, run in `root` with the command as Claude Code sends it: its exit code and its decision. */
const runHookAt = async (opts: { root: string; command: string }) => {
  const child = Bun.spawn([process.execPath, HOOK], {
    cwd: opts.root,
    stdin: new TextEncoder().encode(
      `{"tool_name":"Bash","tool_input":{"command":${JSON.stringify(opts.command)}},"cwd":${JSON.stringify(opts.root)}}`,
    ),
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, CLAUDE_PROJECT_DIR: opts.root },
    timeout: SPAWN_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });
  const stdoutResponse = new Response(child.stdout);
  const result = await stdoutResponse.text();
  const stdout = result.trim();

  const code = await child.exited;

  return {
    code,
    decision: stdout === '' ? '' : JSON.parse(stdout).hookSpecificOutput.permissionDecision,
  };
};

const CASES: { name: string; command: string; flagged: boolean }[] = [
  { name: 'psql SELECT', command: 'psql -h 127.0.0.1 -c "SELECT 1"', flagged: false },
  { name: 'build a package', command: 'make core inventory', flagged: false },
  { name: 'read-only git', command: 'git status --short', flagged: false },
  { name: 'grep the repo', command: 'grep -rn "POST" packages/inventory/src', flagged: false },
  { name: 'run the test suite', command: 'bun run test', flagged: false },
  { name: 'generate a migration', command: 'bun run db:generate:public:develop', flagged: false },
  { name: 'a script the guard does not read', command: 'bun scripts/deploy.ts', flagged: false },
  { name: 'curl POST', command: 'curl -X POST https://example.dev/v1/api/x', flagged: true },
  {
    name: 'psql UPDATE',
    command: `psql -c 'UPDATE inventory."Stock" SET quantity = 0'`,
    flagged: true,
  },
  {
    name: 'psql -f file.sql',
    command: 'psql -h 127.0.0.1 -U postgres -d app -f repair.sql',
    flagged: true,
  },
  { name: 'kubectl apply', command: 'kubectl apply -f manifest.yaml', flagged: true },
  { name: 'docker compose up', command: 'docker compose up -d', flagged: true },
  { name: 'run a migration', command: 'bun run db:migrate:public:develop', flagged: true },
];

describe('WriteGuard.inspectCommand', () => {
  for (const testCase of CASES) {
    test(`${testCase.flagged ? 'flags' : 'passes'}: ${testCase.name}`, () => {
      const hits = WriteGuard.inspectCommand({ command: testCase.command });

      expect(hits.length > 0).toBe(testCase.flagged);
    });
  }

  test('every hit cites a base rule', () => {
    const hits = WriteGuard.inspectCommand({
      command: 'kubectl apply -f m.yaml && curl -X DELETE https://x.dev/a',
    });

    expect(hits.map((hit) => hit.rule).sort()).toEqual(['V-W-02', 'V-W-03']);
  });
});

describe('the guard-writes hook', () => {
  const runHook = async (opts: { stdin: string }) => {
    const child = Bun.spawn([process.execPath, HOOK], {
      stdin: new TextEncoder().encode(opts.stdin),
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: SPAWN_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });
    const stdoutResponse = new Response(child.stdout);
    const stdout = await stdoutResponse.text();

    const result = await child.exited;
    return { code: result, stdout: stdout.trim() };
  };

  test('asks the human, naming the rule, for a write', async () => {
    const result = await runHook({
      stdin: '{"tool_name":"Bash","tool_input":{"command":"kubectl apply -f m.yaml"}}',
    });
    const decision = JSON.parse(result.stdout).hookSpecificOutput;

    expect(decision.hookEventName).toBe('PreToolUse');
    expect(decision.permissionDecision).toBe('ask');
    expect(decision.permissionDecisionReason).toContain('V-W-03');
  });

  test('stays silent for a read', async () => {
    const result = await runHook({
      stdin: '{"tool_name":"Bash","tool_input":{"command":"git status"}}',
    });

    expect(result).toEqual({ code: 0, stdout: '' });
  });

  test.each([
    ['text that is not JSON', 'not json'],
    ['a JSON value that is not an object', '[1]'],
    ['an object without tool_input', '{"tool_name":"Bash"}'],
    ['a command that is not text', '{"tool_name":"Bash","tool_input":{"command":5}}'],
    ['an empty command', '{"tool_name":"Bash","tool_input":{"command":""}}'],
  ])('asks, and never blocks, on %s', async (_label, stdin) => {
    const result = await runHook({ stdin });
    const decision = JSON.parse(result.stdout).hookSpecificOutput;

    expect(result.code).toBe(0);
    expect(decision.permissionDecision).toBe('ask');
    expect(decision.permissionDecisionReason).toContain('the hook input could not be read');
  });
});

describe('the guard-writes hook, on the forms of the commands it covers', () => {
  const root = createProject({ files: {} });

  const runHook = (opts: { command: string }) => runHookAt({ root, command: opts.command });

  test.each([
    'kubectl -n prod apply -f x',
    'kubectl --context prod apply -f x',
    'kubectl --namespace=prod delete pod x',
    'kubectl create deployment web --image=nginx',
    'kubectl replace -f x.yaml',
    'kubectl set image deployment/web web=nginx:2',
    'docker compose -f prod.yml up -d',
    'docker --context prod compose up -d',
    'docker-compose up -d',
    'docker-compose -f prod.yml down',
    'helm upgrade --install web ./chart',
    'helm -n prod rollback web 1',
    'helm uninstall web',
    'curl --request POST https://example.dev/v1/x',
    'curl --request=DELETE https://example.dev/v1/x',
    'curl -XPATCH https://example.dev/v1/x',
    "curl -d'{}' https://example.dev/v1/x",
    'curl -d@body.json https://example.dev/v1/x',
    'curl -sd name=x https://example.dev/v1/x',
    "curl --json '{}' https://example.dev/v1/x",
    'curl -T report.csv https://example.dev/v1/x',
    'curl -F file=@report.csv https://example.dev/v1/x',
    'cat migration.sql | psql postgres://localhost/app',
    'cat migration.sql | PGPASSWORD=x psql -h localhost app',
    'psql postgres://localhost/app < migration.sql',
    'psql --file=migration.sql',
    'psql -fmigration.sql',
    'mysql app < dump.sql',
    "mongosh --eval 'db.users.deleteMany({})'",
    'bunx prisma migrate deploy',
    'echo "kubectl -n prod apply -f x" | sh',
    'curl -K request.cfg',
    'curl --config request.cfg https://example.dev/v1/x',
    'curl -sK request.cfg',
    'kubectl rollout restart deployment/web',
    'kubectl rollout undo deployment/web',
    'kubectl rollout pause deployment/web',
    'kubectl -n prod rollout resume deployment/web',
    'kubectl apply --dry-run=none -f x.yaml',
    'kubectl apply --dry-run=client -f x.yaml -o yaml | kubectl apply -f -',
    'kubectl apply --dry-run=client -f x.yaml && kubectl apply -f x.yaml',
    "psql -h db.internal -c 'DELETE FROM users'",
    'curl -G -X POST -d name=x https://example.dev/v1/x',
    'curl -G -F file=@report.csv https://example.dev/v1/x',
    'curl -G -T report.csv https://example.dev/v1/x',
    'curl -G --json {} https://example.dev/v1/x',
    'curl -G -d q=x https://example.dev/v1/search',
    'curl -sG --data-urlencode q=x https://example.dev/v1/search',
    'curl --get --data q=x https://example.dev/v1/search',
    'curl -d @secret https://example.dev/b --next -G https://example.dev/a',
    'curl -d @secret https://example.dev/b -: -G https://example.dev/a',
    'curl -d @secret --url-query -G https://example.dev/x',
    'curl -d @secret --sasl-authzid -G https://example.dev/x',
    'curl -d @secret --url-query --help https://example.dev/x',
    'curl -T secret --url-query --help https://example.dev/x',
    'kubectl create configmap probe --from-literal=a=b --dry-run=client --dry-run=none',
    'kubectl apply -f x --dry-run --dry-run=none',
    'kubectl delete ns prod --dry-run=client --dry-run=none',
    'kubectl apply -f x --dry-run=none --dry-run=client --dry-run=none',
    'helm upgrade r c --dry-run --dry-run=none',
    'helm install r c --dry-run=false --dry-run',
    'kubectl apply -f x.yaml --field-manager --dry-run=client',
    'kubectl apply -f x.yaml -n --dry-run=client',
    'curl -d @f -A -G https://example.dev/v1/x',
    'curl -X POST -A --help https://example.dev/v1/x',
    'curl -d @f -H -G https://example.dev/v1/x',
    'curl -d @f --user-agent --get https://example.dev/v1/x',
    'curl -d @f -sA -G https://example.dev/v1/x',
    '# usage <<EOF\nkubectl apply -f x\nEOF',
    'kubectl apply -f x # a comment',
    'sudo kubectl apply -f x.yaml',
    'sh -c "kubectl apply -f x"',
    'eval "kubectl apply -f x"',
    'echo $(kubectl apply -f x)',
    'timeout 5 terraform apply',
    'env A=1 helm upgrade web ./chart',
    'echo x.yaml | xargs kubectl apply -f',
    'cat q.sql | psql -c "DROP TABLE a"',
    "find . -name '*.yaml' -exec kubectl apply -f {} \\;",
  ])('asks for %p', async (command) => {
    const result = await runHook({ command });
    expect(result).toEqual({ code: 0, decision: 'ask' });
  });

  test.each([
    'kubectl get pods -n prod',
    'kubectl -n prod get pods',
    'kubectl auth can-i delete pods',
    'kubectl config set-context dev',
    'docker ps',
    'docker compose ps',
    'docker compose -f up.yml logs',
    'helm list -n prod',
    'helm template web ./chart',
    'curl https://example.dev/v1/x',
    'curl -fsSL https://example.dev/install -o install.txt',
    'curl -I https://example.dev/v1/x',
    "curl -sS -H 'Accept: application/json' https://example.dev/v1/x",
    "psql -c 'SELECT 1'",
    'psql -h localhost -d app -c "select count(*) from users"',
    'psql --version',
    'psql -l',
    "mysql -e 'select 1'",
    "mongosh --eval 'db.users.find()'",
    'bunx prisma migrate status',
    'bun test',
    'curl -k https://example.dev/v1/x',
    'kubectl rollout status deployment/web',
    'kubectl -n prod rollout history deployment/web',
    'kubectl apply --dry-run=client -f x.yaml',
    'kubectl apply -f x.yaml --dry-run=server',
    'kubectl delete pod web --dry-run',
    'kubectl apply -h',
    'kubectl apply --help',
    'helm upgrade --install web ./chart --dry-run',
    'helm uninstall --help',
    'docker compose up --help',
    'docker-compose down -h',
    'aws lambda list-functions',
    'aws lambda get-function --function-name f',
    'aws sns list-topics',
    'aws sqs receive-message --queue-url q',
    'aws sqs get-queue-attributes --queue-url q',
    'aws ec2 describe-security-groups',
    'aws iam list-users',
    'aws iam get-user --user-name bob',
    'aws ssm describe-instance-information',
    'aws lambda invoke --help',
    'aws ec2 authorize-security-group-ingress --dry-run --group-id sg-1',
    'gcloud compute instances list',
    'gcloud compute instances describe vm-1',
    'gcloud sql instances list',
    'gcloud sql instances describe db',
    'gcloud storage ls',
    'gcloud storage cat gs://bucket/key',
    'gcloud projects get-iam-policy p',
    'gsutil ls gs://bucket',
    'gsutil cat gs://bucket/key',
    'gsutil du gs://bucket',
    'az vm list',
    'az vm show --name vm --resource-group g',
    'kubectl get pods',
    'kubectl logs pod/web',
    'kubectl describe pod web',
    'kubectl top pods',
    'kubectl exec --help',
    'docker images',
    'docker pull registry.example.test/app:1',
    'docker build .',
    'docker logs web',
    'docker push --help',
    'kubectl apply -f x.yaml --field-manager fm --dry-run=client',
    'kubectl apply -f x.yaml --dry-run=client -o yaml',
    'helm upgrade r c --dry-run --atomic',
    'curl -X POST --help https://example.dev/v1/x',
    "find . -exec sh -c 'echo x' \\;",
    'find . -name x -exec echo {} \\;',
    'find . -type f -exec rm {} +',
    "find . -exec bash -c 'echo hi' \\; -exec echo {} \\;",
    "echo a | xargs -n1 bash -c 'echo $0'",
    "ls | xargs -I% sh -c 'echo x'",
    'echo sh {}',
    'LD_PRELOAD= ls',
    'NODE_OPTIONS=--max-old-space-size=4096 node -e 0',
    'NODE_OPTIONS=--trace-warnings node -e 0',
    "cat <<'EOF'\n${x@P}\nEOF",
    'cat <<EOF\n${x@Q}\nEOF',
    'fd . --exec echo',
    'fd . -x echo {}',
    'fd . --exec=echo',
    'echo x | xargs',
    'xargs -L1 echo',
    'fd . --exec echo {}',
    'find . -exec echo {} \\;',
    '[ -f x ] && echo y',
    '[[ -f x ]]',
    'echo ${x@Q}',
    'echo ${x@U}',
    'BASH_ENV= bash -c true',
    'echo BASH_ENV=x',
    'FOO=1 bash -c true',
  ])('stays silent for %p', async (command) => {
    const result = await runHook({ command });
    expect(result).toEqual({ code: 0, decision: '' });
  });
});

describe('the guard-writes hook, on the deploy, cloud, migration and request tools it knows', () => {
  const root = createProject({ files: {} });

  const runHook = (opts: { command: string }) => runHookAt({ root, command: opts.command });

  test.each([
    'terraform apply',
    'terraform -chdir=infra apply -auto-approve',
    'tofu destroy',
    'terraform import aws_instance.web i-123',
    'terraform taint aws_instance.web',
    'terraform state rm aws_instance.web',
    'pulumi up --yes',
    'pulumi destroy',
    'pulumi refresh',
    'ansible-playbook site.yml',
    "ansible all -m shell -a 'rm -rf /var/cache/app'",
    "ansible web -m copy -a 'src=a dest=b'",
    "ansible web -a 'systemctl restart app'",
    'flyctl deploy',
    'fly deploy --remote-only',
    'fly scale count 2',
    'fly secrets set TOKEN=x',
    'fly apps destroy web',
    'vercel --prod',
    'vercel deploy',
    'netlify deploy --prod',
    'wrangler deploy',
    'wrangler publish',
    'wrangler delete',
    'wrangler secret put TOKEN',
    'gcloud run deploy web --image gcr.io/p/web',
    'gcloud compute instances delete vm-1',
    'gcloud projects set-iam-policy p policy.json',
    'az group create -n rg -l westeurope',
    'az webapp deploy --src-path app.zip',
    'az vm delete -n vm-1',
    'aws s3 rm s3://bucket/key',
    'aws s3 sync ./dist s3://bucket',
    'aws s3 cp report.csv s3://bucket/report.csv',
    'aws ec2 delete-security-group --group-id sg-1',
    'aws --region eu-west-1 lambda update-function-code --function-name f --zip-file fileb://f.zip',
    'aws s3api put-object --bucket b --key k',
    'aws cloudformation deploy --template-file t.yml --stack-name s',
    'cdk deploy',
    'npx cdk destroy',
    'helmfile apply',
    'helmfile -e prod sync',
    'argocd app sync web',
    'argocd app delete web',
    'skaffold run',
    'skaffold deploy',
    'docker stack deploy -c stack.yml web',
    'docker stack rm web',
    'docker service create --name web nginx',
    'docker service scale web=3',
    'docker swarm init',
    'kubectl edit deployment/web',
    'kubectl run debug --image=busybox',
    'kubectl label pod web tier=front',
    'kubectl annotate pod web note=x',
    'kubectl drain node-1',
    'kubectl cordon node-1',
    'kubectl uncordon node-1',
    'kubectl taint nodes node-1 key=value:NoSchedule',
    'kubectl expose deployment web --port=80',
    'oc apply -f x.yaml',
    'oc -n prod delete pod web',
    'aws lambda invoke --function-name f out.json',
    'aws sns publish --topic-arn arn:x --message m',
    'aws sqs send-message --queue-url q --message-body b',
    'aws sqs send-message-batch --queue-url q --entries file://e.json',
    'aws sqs purge-queue --queue-url q',
    'aws ec2 authorize-security-group-ingress --group-id sg-1 --protocol tcp --port 22 --cidr 0.0.0.0/0',
    'aws ec2 authorize-security-group-egress --group-id sg-1 --protocol all',
    'aws iam add-user-to-group --user-name bob --group-name admins',
    'aws iam attach-user-policy --user-name bob --policy-arn arn:x',
    'aws ssm send-command --instance-ids i-1 --document-name AWS-RunShellScript',
    'aws ssm start-session --target i-1',
    'aws --profile prod --region eu-west-1 lambda invoke --function-name f out.json',
    'gcloud compute instances stop vm-1',
    'gcloud compute instances start vm-1',
    'gcloud --project p compute instances delete vm-1',
    'gcloud sql instances patch db --tier db-n1-standard-2',
    'gcloud sql instances delete db',
    'gcloud projects add-iam-policy-binding p --member user:a@example.test --role roles/owner',
    'gcloud storage rm gs://bucket/key',
    'gsutil rm gs://bucket/key',
    'gsutil -m cp -r dist gs://bucket',
    'gsutil mv gs://bucket/a gs://bucket/b',
    'gsutil rsync -r dist gs://bucket',
    'az vm stop --name vm --resource-group g',
    'az vm start --name vm --resource-group g',
    'az vm deallocate --name vm --resource-group g',
    'az vm restart --name vm --resource-group g',
    'kubectl cp pod:/var/log/x ./x',
    'kubectl debug pod/web -it --image=busybox',
    'kubectl autoscale deployment web --max=3',
    'kubectl -n prod exec pod/web -- ls',
    'oc exec pod/web -- ls',
    'docker push registry.example.test/app:1',
    'docker image push registry.example.test/app:1',
    'redis-cli FLUSHALL',
    'redis-cli -h cache -p 6379 flushdb',
    'redis-cli DEL session:1',
    'redis-cli SET key value',
    'redis-cli HSET user:1 name x',
    'redis-cli EXPIRE key 10',
    'redis-cli CONFIG SET maxmemory 1mb',
    'redis-cli SHUTDOWN',
    'dropdb app',
    'createdb app',
    'pg_restore -d app dump.custom',
    'createuser bob',
    'dropuser bob',
    'mysqladmin -u root drop app',
    'mysqladmin create app',
    'mysqladmin shutdown',
    'mongorestore dump/',
    'mongoimport --db app --collection users users.json',
    'knex migrate:latest',
    'npx knex migrate:rollback',
    'npx typeorm migration:run',
    'typeorm migration:revert',
    'alembic upgrade head',
    'alembic -c alembic.ini downgrade -1',
    'alembic stamp head',
    'python manage.py migrate',
    'python3 manage.py flush',
    './manage.py loaddata fixtures.json',
    'flyway migrate',
    'flyway -url=jdbc:postgresql://db/app clean',
    'goose -dir db/migrations postgres "user=app dbname=app" up',
    'goose down',
    'dbmate up',
    'dbmate drop',
    'supabase db push',
    'supabase db reset',
    'drizzle-kit up',
    'drizzle-kit drop',
    'drizzle-kit push --config drizzle.config.ts',
    'bunx prisma migrate resolve --applied 20240101_init',
    'npx sequelize-cli db:seed:all',
    'sequelize db:migrate',
    'rails db:drop',
    'bundle exec rails db:seed',
    'php artisan migrate',
    'php artisan migrate:fresh',
    "wget --post-data 'name=x' https://example.dev/v1/x",
    'wget --post-file body.json https://example.dev/v1/x',
    'wget --method=DELETE https://example.dev/v1/x',
    'wget --method PUT https://example.dev/v1/x',
    'http POST example.dev/v1/x name=x',
    'https PUT example.dev/v1/x name=x',
    'xh DELETE example.dev/v1/x',
    'http --form POST example.dev/v1/x name=x',
    'aws ec2 terminate-instances --instance-ids i-1',
    'aws ec2 stop-instances --instance-ids i-1',
    'aws rds reboot-db-instance --db-instance-identifier app',
    'aws ec2 modify-instance-attribute --instance-id i-1 --no-disable-api-termination',
    'aws iam attach-role-policy --role-name app --policy-arn arn:x',
    'aws iam detach-role-policy --role-name app --policy-arn arn:x',
    'aws ecs register-task-definition --cli-input-json file://task.json',
    'aws elbv2 deregister-targets --target-group-arn arn:x --targets Id=i-1',
    'aws ec2 run-instances --image-id ami-1',
    'aws ec2 start-instances --instance-ids i-1',
    'aws s3 mb s3://bucket',
    'aws s3 rb s3://bucket',
    'aws s3 mv s3://bucket/a s3://bucket/b',
    "redis-cli EVAL \"return redis.call('del','k')\" 0",
    'redis-cli UNLINK key',
    'redis-cli LPUSH q x',
    'redis-cli INCR counter',
    'redis-cli SETEX k 10 v',
    'redis-cli -h cache -p 6379 -n 2 FLUSHDB',
    'redis-cli CONFIG SET maxmemory 1gb',
    'redis-cli',
    'redis-cli -h cache',
    'redis-cli --eval script.lua key',
    'redis-cli <<EOF\nGET a\nDEL b\nEOF',
    'docker exec cache redis-cli FLUSHALL',
    'typeorm schema:drop',
    'typeorm schema:sync',
    'rails db:schema:load',
    'rails db:setup',
    'rails db:structure:load',
    'rails db:rollback',
    'python manage.py shell',
    'python manage.py dbshell',
    'python manage.py migrate',
    'npx prisma migrate deploy',
    'prisma db push --create-only',
    'prisma migrate deploy --create-only',
    'http :3000/users name=x',
    "http :3000/users 'age:=1'",
    'http :3000/users @data.json',
    'http :3000/users avatar=@photo.png',
    'xh example.dev/v1/x name=x',
    'http PURGE example.dev/v1/x',
  ])('asks for %p', async (command) => {
    const result = await runHook({ command });
    expect(result).toEqual({ code: 0, decision: 'ask' });
  });

  test.each([
    'terraform plan',
    'terraform show',
    'tofu validate',
    'terraform state list',
    'terraform apply -help',
    'pulumi preview',
    'pulumi stack ls',
    'ansible-playbook site.yml --check',
    'ansible-playbook -C site.yml',
    'ansible-playbook --syntax-check site.yml',
    'ansible all -m ping',
    'fly status',
    'fly logs',
    'fly scale show',
    'fly secrets list',
    'vercel ls',
    'vercel build --prod',
    'tar -a -cf out.tar.gz dist',
    'uname -a',
    'aws s3 cp -a s3://bucket/report.csv .',
    'netlify status',
    'wrangler tail',
    'gcloud config list',
    'gcloud compute instances list',
    'gcloud run services describe web',
    'az group list',
    'az account show',
    'aws s3 ls',
    'aws s3 ls s3://bucket/delete-me/',
    'aws sts get-caller-identity',
    'aws s3 cp s3://bucket/report.csv .',
    'aws ec2 describe-instances',
    'aws s3 sync ./dist s3://bucket --dryrun',
    'cdk diff',
    'cdk synth',
    'helmfile diff',
    'helmfile template',
    'argocd app list',
    'argocd app get web',
    'skaffold build',
    'docker stack ls',
    'docker service ls',
    'docker service logs web',
    'docker swarm join-token worker',
    'kubectl get pods',
    'kubectl describe pod web',
    'kubectl logs web',
    'kubectl auth can-i delete pods',
    'kubectl config set-context dev',
    'oc get pods',
    'oc status',
    'redis-cli GET x',
    'redis-cli ping',
    "redis-cli -h cache KEYS 'session:*'",
    'redis-cli --help',
    'pg_restore -l dump.custom',
    'pg_dump app -f backup.sql',
    'createdb --help',
    'mysqladmin status',
    'mysqladmin -u root processlist',
    'mongodump --db app',
    'mongoimport --help',
    'knex migrate:status',
    'knex migrate:make add_users',
    'typeorm migration:show',
    'alembic history',
    'alembic current',
    'alembic revision -m add_users',
    'python manage.py showmigrations',
    'python manage.py makemigrations',
    'python3 -m http.server --help',
    'flyway info',
    'flyway validate',
    'goose status',
    'goose create add_users sql',
    'dbmate status',
    'dbmate new add_users',
    'supabase db diff',
    'supabase status',
    'drizzle-kit generate',
    'prisma migrate status',
    'prisma generate',
    'php artisan migrate:status',
    'rails routes',
    'wget https://example.dev/v1/x',
    'wget -O page.html https://example.dev/',
    'http GET example.dev/v1/x',
    'http example.dev/v1/x',
    'xh example.dev/v1/x',
    'curl https://example.dev/v1/x',
    'aws ec2 terminate-instances --instance-ids i-1 --dry-run',
    'aws ec2 describe-instances --filters Name=instance-state-name,Values=stopped',
    'redis-cli GET x',
    'redis-cli -h cache -p 6379 MGET a b',
    'redis-cli -n 2 HGETALL user:1',
    'redis-cli CLIENT LIST',
    'redis-cli CONFIG GET maxmemory',
    'redis-cli MEMORY USAGE key',
    'redis-cli SLOWLOG GET 10',
    'redis-cli -a secret INFO',
    "redis-cli --scan --pattern 'user:*'",
    'redis-cli --bigkeys',
    'redis-cli --stat',
    'redis-cli --latency',
    'redis-cli zrange board 0 -1',
    'alembic upgrade head --sql',
    'alembic heads',
    'alembic branches',
    'alembic show head',
    'prisma migrate dev --create-only',
    'npx prisma migrate dev --create-only',
    'prisma migrate diff --from-empty --to-schema-datamodel schema.prisma',
    'prisma db pull',
    'prisma format',
    'prisma validate',
    'sequelize db:migrate:status',
    'rails db:migrate:status',
    'rails db:version',
    'python manage.py migrate --plan',
    'python manage.py runserver',
    'python manage.py check',
    'knex migrate:list',
    'knex migrate:currentVersion',
    'goose version',
    'drizzle-kit check',
    'drizzle-kit studio',
    'drizzle-kit introspect',
    'typeorm migration:generate src/migrations/AddUsers',
    'typeorm migration:create src/migrations/AddUsers',
    'http :3000/users q==x',
    'http :3000/users Authorization:token',
    "http 'example.dev/v1/x?a=b'",
    'http -a user:pass example.dev/v1/x',
    'http GET :3000/users name=x',
    'http HEAD example.dev/v1/x',
    'http OPTIONS example.dev/v1/x',
    'http example.dev/v1/x --session=dev',
    'http --offline :3000/users name=x',
  ])('stays silent for %p', async (command) => {
    const result = await runHook({ command });
    expect(result).toEqual({ code: 0, decision: '' });
  });

  test('reads a line of thousands of options within the work budget', () => {
    const start = performance.now();

    WriteGuard.inspectCommand({ command: `ansible all ${'-x '.repeat(30_000)}` });
    WriteGuard.inspectCommand({ command: `psql -c "merge ${'/* '.repeat(30_000)}"` });
    WriteGuard.inspectCommand({ command: `http ${'x'.repeat(64_000)}` });
    WriteGuard.inspectCommand({ command: `redis-cli${' -h x'.repeat(12_000)}` });

    expect(performance.now() - start).toBeLessThan(2500);
  });

  test('names the cloud action in the reason', () => {
    const [hit] = WriteGuard.inspectCommand({ command: 'terraform apply' });

    expect(hit?.rule).toBe('V-W-03');
    expect(hit?.message).toBe('deploying or changing cloud resources');
  });
});

describe('the guard-writes hook, on the SQL a database client is given', () => {
  const root = createProject({ files: {} });

  const runHook = (opts: { command: string }) => runHookAt({ root, command: opts.command });

  test.each([
    "mariadb -e 'DELETE FROM t'",
    'mysql -e"DELETE FROM t"',
    'psql -c"DROP TABLE t"',
    "psql -qc'DELETE FROM t'",
    "psql -c 'DELETE/**/FROM t'",
    "psql -c 'TRUNCATE t;'",
    "psql -c 'merge into t using s on t.id = s.id when matched then do nothing'",
    "psql -c 'CALL refresh_all()'",
    `psql -c "COPY users FROM '/srv/users.csv'"`,
    "psql -c 'COPY users (id, name) FROM STDIN'",
    "mysql -e 'REPLACE INTO t VALUES (1)'",
    "psql -c 'GRANT ALL ON t TO bob'",
    "psql -c 'ALTER TABLE t ADD c int'",
    'psql -c "$SQL"',
    'psql -c "$(cat q.sql)"',
    'mysql -e "`cat q.sql`"',
    'psql --command="$SQL"',
    "psql -c '\\i repair.sql'",
    "mysql -e 'source repair.sql'",
    'sqlite3 app.db',
    'sqlite3 app.db < q.sql',
    'cat q.sql | sqlite3 app.db',
    'sqlite3 app.db ".read q.sql"',
    'sqlite3 app.db "DELETE FROM t"',
    'sqlite3 app.db ".import users.csv users"',
    'sqlite3 -init q.sql app.db .tables',
    'mongosh drop.js',
    'mongosh mongodb://db/app drop.js',
    'mongosh --file drop.js',
    "mongosh --eval 'db.runCommand({ dropDatabase: 1 })'",
    "mongosh --eval 'db.users.drop()'",
    "mongosh --eval 'db.users.createIndex({ a: 1 })'",
    'cat drop.js | mongosh',
    'mariadb app <<EOF\nDELETE FROM t;\nEOF',
    'mariadb app < q.sql',
    'psql -c "VACUUM FULL t"',
    'psql -c "vacuum"',
    'psql -c "REINDEX TABLE t"',
    'psql -c "CLUSTER t USING t_pkey"',
    'psql -c "CLUSTER;"',
    'psql -c "REFRESH MATERIALIZED VIEW report"',
    'psql -c "LOCK TABLE t IN ACCESS EXCLUSIVE MODE"',
    'psql -c "SELECT pg_terminate_backend(123)"',
    'psql -c "SELECT pg_cancel_backend(123)"',
    'psql -c "SELECT setval(\'s\', 1)"',
    'psql -c "SELECT nextval(\'s\')"',
    'psql -c "SELECT lo_unlink(42)"',
    'psql -c "SELECT pg_drop_replication_slot(\'slot\')"',
    'psql -c "SELECT pg_reload_conf()"',
    'mongo app --eval "db.c.remove({})"',
    "mongo --eval 'db.users.drop()'",
    'mongo drop.js',
    'mongo --file drop.js',
    'mongo app',
    'cat drop.js | mongo',
    '/usr/bin/mongo --eval "db.c.remove({})"',
  ])('asks for %p', async (command) => {
    const result = await runHook({ command });
    expect(result).toEqual({ code: 0, decision: 'ask' });
  });

  test.each([
    "psql -c 'COPY (SELECT * FROM users) TO STDOUT'",
    "psql -c 'COPY users TO STDOUT'",
    `psql -c "SELECT replace(name, 'a', 'b') FROM t"`,
    'mysql -e"SELECT 1"',
    "psql -qc'SELECT 1'",
    "mariadb -e 'SELECT 1'",
    'psql -c "SELECT created_at FROM t"',
    `psql -c "SELECT * FROM t WHERE status = 'update'"`,
    'sqlite3 app.db "SELECT count(*) FROM t"',
    'sqlite3 app.db .tables',
    'sqlite3 -version',
    "mongosh --eval 'db.users.find()'",
    'mongosh --version',
    'psql -c "ANALYZE t"',
    'psql -c "SET search_path TO app"',
    'psql -h cluster -c "SELECT 1"',
    'psql -h lock.internal app -c "SELECT 1"',
    'psql -c "SELECT * FROM pg_stat_activity"',
    "mongo app --eval 'db.users.find()'",
    'mongo --version',
  ])('stays silent for %p', async (command) => {
    const result = await runHook({ command });
    expect(result).toEqual({ code: 0, decision: '' });
  });
});
