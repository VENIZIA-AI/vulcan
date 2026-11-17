import { createRoot } from 'react-dom/client';
import type { IBoardData } from '../common/index.ts';
import { App } from './app.tsx';

const block = document.getElementById('board-data');
const root = document.getElementById('root');

if (block?.textContent && root) {
  const data: IBoardData = JSON.parse(block.textContent);

  createRoot(root).render(<App data={data} />);
}
