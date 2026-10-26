/**
 * Test preload (`[test] preload` in the bunfig of the root and of every package): a bare `bun test`
 * makes its temp folders in the repository, like `make test` does (see ./repo-tmp.ts).
 */
import { useRepoTmp } from './repo-tmp.ts';

useRepoTmp();
