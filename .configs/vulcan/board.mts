import type { VulcanConfig } from '@venizia/vulcan';

export const board = {
  events: { log: true },
  // The names on this repository's board page (vulcan board show): the owner who answers asks, the title, the logo, and the faces of the Venizia agents.
  page: {
    owner: 'Phát',
    title: 'VENIZIA Board',
    logo: '.configs/board-logo.svg',
    agents: {
      'pnt-ignis-1': 'flame',
      'pnt-ardor-1': 'ember',
      'pnt-vulcan-1': 'rock',
    },
  },
} satisfies VulcanConfig.BoardType;
