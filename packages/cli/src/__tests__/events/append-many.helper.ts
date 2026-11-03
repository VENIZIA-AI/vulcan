import { EventLog } from '../../events/index.ts';

/** Appends `count` events to `dir` as fast as it can; run by several processes at once by the log test. */
const [dir, worker, count] = process.argv.slice(2);

for (let index = 0; index < Number(count); index++) {
  EventLog.append({
    dir,
    event: EventLog.build({
      kind: 'commit',
      summary: `worker ${worker} line ${index} ${'x'.repeat(300)}`,
      actor: `worker-${worker}`,
      source: 'cli',
    }),
  });
}
