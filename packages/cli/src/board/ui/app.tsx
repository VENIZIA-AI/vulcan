import type { IBoardData } from '../common/index.ts';

interface IAppProps {
  data: IBoardData;
}

export const App = (opts: IAppProps) => <h1 id="boardTitle">{opts.data.title}</h1>;
