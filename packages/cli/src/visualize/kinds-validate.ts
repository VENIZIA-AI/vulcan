import { LifecycleKinds, NewKindLimits } from './kinds-schema.ts';
import type { ITreeNode, TLifecycle, TSequence, TTree } from './kinds-schema.ts';

/** The part of a page spec the three kinds live in; the full spec fits it once the kinds are registered. */
export interface INewKindsSpec {
  sequence?: TSequence | undefined;
  lifecycle?: TLifecycle | undefined;
  tree?: TTree | undefined;
}

const checkSequence = (opts: { sequence: TSequence }): string[] => {
  const problems: string[] = [];
  const ids = new Set<string>();

  for (const participant of opts.sequence.participants) {
    if (ids.has(participant.id)) {
      problems.push(`sequence.participants: id '${participant.id}' is used twice`);
    }

    ids.add(participant.id);
  }

  for (const [index, message] of opts.sequence.messages.entries()) {
    const name = `${message.from}>${message.to}`;

    for (const end of [message.from, message.to]) {
      if (!ids.has(end)) {
        problems.push(
          `sequence.messages[${index}]: '${name}' names '${end}', which is not a participant`,
        );
      }
    }

    if (message.from === message.to) {
      problems.push(
        `sequence.messages[${index}]: '${name}' goes from a participant to itself - send it to another participant`,
      );
    }
  }

  return problems;
};

/** The ids reachable from `start` along the transitions. */
const reachableFrom = (opts: { lifecycle: TLifecycle; start: string }): Set<string> => {
  const seen = new Set<string>([opts.start]);
  const queue = [opts.start];

  while (queue.length > 0) {
    const at = queue.shift();

    for (const transition of opts.lifecycle.transitions) {
      if (transition.from === at && !seen.has(transition.to)) {
        seen.add(transition.to);
        queue.push(transition.to);
      }
    }
  }

  return seen;
};

const checkLifecycle = (opts: { lifecycle: TLifecycle }): string[] => {
  const { lifecycle } = opts;
  const problems: string[] = [];
  const ids = new Set<string>();

  for (const state of lifecycle.states) {
    if (ids.has(state.id)) {
      problems.push(`lifecycle.states: id '${state.id}' is used twice`);
    }

    ids.add(state.id);
  }

  const starts = lifecycle.states.filter((state) => state.kind === LifecycleKinds.START);
  const ends = lifecycle.states.filter((state) => state.kind === LifecycleKinds.END);

  if (starts.length !== 1) {
    problems.push(
      starts.length === 0
        ? "lifecycle.states: there is no state of kind 'start' - exactly one is needed"
        : `lifecycle.states: ${starts.length} states are of kind 'start' (${starts.map((state) => `'${state.id}'`).join(', ')}) - exactly one is needed`,
    );
  }

  if (ends.length === 0) {
    problems.push("lifecycle.states: there is no state of kind 'end' - at least one is needed");
  }

  const names = new Set<string>();

  for (const transition of lifecycle.transitions) {
    const name = `${transition.from}>${transition.to}`;

    for (const end of [transition.from, transition.to]) {
      if (!ids.has(end)) {
        problems.push(`lifecycle.transitions: '${name}' names '${end}', which is not a state`);
      }
    }

    if (transition.from === transition.to) {
      problems.push(`lifecycle.transitions: '${name}' loops to itself - name the state it goes to`);
    }

    if (names.has(name)) {
      problems.push(
        `lifecycle.transitions: '${name}' is listed twice - put both triggers in one label`,
      );
    }

    names.add(name);

    if (ends.some((state) => state.id === transition.from)) {
      problems.push(
        `lifecycle.transitions: '${name}' leaves the end state '${transition.from}' - an end has nothing after it`,
      );
    }
  }

  const [start] = starts;

  if (starts.length === 1 && start !== undefined) {
    const reached = reachableFrom({ lifecycle, start: start.id });

    for (const state of lifecycle.states) {
      if (!reached.has(state.id)) {
        problems.push(
          `lifecycle.states: '${state.id}' cannot be reached from the start '${start.id}'`,
        );
      }
    }
  }

  return problems;
};

const checkTree = (opts: { tree: TTree }): string[] => {
  const problems: string[] = [];
  const ids = new Set<string>();
  let count = 0;
  let deepest = 0;
  const walk = (node: ITreeNode, depth: number): void => {
    count += 1;
    deepest = Math.max(deepest, depth);

    if (ids.has(node.id)) {
      problems.push(`tree: id '${node.id}' is used twice`);
    }

    ids.add(node.id);

    for (const child of node.children ?? []) {
      walk(child, depth + 1);
    }
  };

  walk(opts.tree.root, 0);

  if (count > NewKindLimits.MAX_TREE_NODES) {
    problems.push(
      `tree: ${count} nodes, at most ${NewKindLimits.MAX_TREE_NODES} - split it into two trees`,
    );
  }

  if (deepest > NewKindLimits.MAX_TREE_DEPTH) {
    problems.push(
      `tree: ${deepest} levels below the root, at most ${NewKindLimits.MAX_TREE_DEPTH}`,
    );
  }

  return problems;
};

/** What a schema cannot say about the sequence, the lifecycle and the tree: ids, ends of arrows, reach, limits. */
export const checkNewKinds = (opts: { spec: INewKindsSpec }): string[] => {
  const { sequence, lifecycle, tree } = opts.spec;

  return [
    ...(sequence === undefined ? [] : checkSequence({ sequence })),
    ...(lifecycle === undefined ? [] : checkLifecycle({ lifecycle })),
    ...(tree === undefined ? [] : checkTree({ tree })),
  ];
};
