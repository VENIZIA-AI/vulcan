/**
 * An architecture page made to break the drawing: four boxes in a layer, a long sub-label that must wrap, links inside
 * one layer, between neighbouring layers, over several layers, upwards, and with no label. The browser test measures
 * it; nothing here is a real report.
 */
const box = (id: string, label: string, sub?: string, state?: string) => ({
  id,
  label,
  ...(sub === undefined ? {} : { sub }),
  ...(state === undefined ? {} : { state }),
});

export const architectureSpec = (): Record<string, unknown> => ({
  schemaVersion: 1,
  language: 'vi',
  title: 'Ba hộp một tầng, liên kết cùng hàng và xuyên nhiều tầng',
  status: { state: 'ok', label: 'Đúng tiến độ' },
  verdict: 'Mỗi liên kết đi đường riêng, không xuyên hộp; nhãn nằm ở chỗ trống.',
  architecture: {
    layers: [
      {
        label: 'Chủ dự án thấy',
        boxes: [
          box('v', 'Trang trình bày', 'vulcan visualize'),
          box('c', 'Lệnh vulcan', 'init, sync, doctor'),
          box('w', 'Trang wiki', 'VitePress, ba kho'),
        ],
      },
      {
        label: 'Chạy trong tác tử',
        boxes: [
          box('r', 'Luật 40 điều', 'rules.md'),
          box('h', 'Hook chặn lệnh', 'guard-writes, guard-git', 'blocked'),
          box('s', '12 kỹ năng', 'SKILL.md'),
        ],
      },
      {
        label: 'Chạy ở CI và phát hành',
        boxes: [
          box('i', 'Cổng kiểm CI', 'ci.yml'),
          box('p', 'Phát hành npm', 'package-release.yml'),
          box('o', 'Kiểm tri thức', 'okf check'),
        ],
      },
      {
        label: 'Hạ tầng',
        boxes: [box('n', 'Kho npm', 'next và latest'), box('g', 'GitHub Pages', 'wiki')],
      },
    ],
    links: [
      { from: 'c', to: 'h', label: 'sync ghi' },
      { from: 'p', to: 'c', label: 'đăng gói' },
      { from: 'w', to: 'v', label: 'đọc nguồn' },
      { from: 'p', to: 'n', label: 'đăng lên' },
      { from: 'c', to: 'n', label: 'cài từ' },
      { from: 'o', to: 'g', label: 'dựng' },
      { from: 'h', to: 'v' },
      { from: 'c', to: 's', label: 'sync nối' },
    ],
  },
});
