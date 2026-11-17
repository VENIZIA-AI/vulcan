/**
 * A page of figures with long labels in Vietnamese (accents widen a line), made to overflow a box, to push an arrow
 * label onto a box, and to push a step diagram past its column. The browser test measures it; nothing here is a real
 * report.
 */
export const figuresSpec = (): Record<string, unknown> => ({
  schemaVersion: 1,
  language: 'vi',
  title: 'Một dòng dữ liệu đi từ nhân viên tới sổ riêng của cửa hàng khác',
  status: { state: 'warn', label: 'Đang giữ, chưa gộp' },
  verdict:
    'Chữ phải nằm gọn trong hộp, nhãn mũi tên không đè lên viền hộp, sơ đồ không có thanh cuộn ngang.',
  flow: {
    nodes: [
      {
        id: 'a',
        label: 'Nhân viên kiêm nhiệm',
        sublabel: 'quản lý ban tổ chức O-A',
        row: 0,
        col: 0,
        kind: 'actor',
      },
      {
        id: 'b',
        label: 'Bộ kiểm quyền ghi',
        sublabel: 'ScopeWriteGuard',
        row: 0,
        col: 1,
        kind: 'service',
        state: 'blocked',
      },
      {
        id: 'c',
        label: 'Dữ liệu vừa tạo',
        sublabel: 'ghi nhầm mã cửa hàng của người khác',
        row: 0,
        col: 2,
        kind: 'store',
        state: 'blocked',
      },
      {
        id: 'd',
        label: 'Cửa hàng B',
        sublabel: 'thấy dữ liệu của người khác',
        row: 0,
        col: 3,
        kind: 'actor',
      },
      {
        id: 'e',
        label: 'Sổ nhật ký kiểm tra',
        sublabel: 'ghi lại mọi lần thử',
        row: 1,
        col: 1,
        kind: 'store',
      },
    ],
    edges: [
      { from: 'a', to: 'b', label: 'ghi organizer o-a' },
      { from: 'b', to: 'c', label: 'cho phép lưu' },
      { from: 'c', to: 'd', label: 'lọt vào sổ riêng', variant: 'error' },
      { from: 'b', to: 'e', label: 'ghi lại' },
    ],
    steps: [
      {
        title: 'Gửi dữ liệu',
        note: 'Một nhân viên gửi dòng mới.',
        nodes: ['a', 'b'],
        edges: ['a>b'],
      },
    ],
  },
  explainer: {
    steps: [
      {
        title: 'Nhân viên gửi một dòng mới',
        text: 'Nhân viên quản lý ban tổ chức tạo dòng dữ liệu, điền mã ban tổ chức của mình và mã cửa hàng của người khác.',
        diagram: {
          type: 'row',
          nodes: [
            { label: 'Nhân viên kiêm nhiệm', sub: 'quản lý ban tổ chức O-A' },
            { label: 'Bộ kiểm quyền ghi', sub: 'ScopeWriteGuard' },
            { label: 'Sổ riêng của cửa hàng B', sub: 'dữ liệu của người khác' },
          ],
          arrows: ['ghi organizer o-a', 'cho phép lưu'],
        },
      },
      {
        title: 'Ba tầng cùng đọc một dòng',
        text: 'Dòng đi qua ba tầng; mỗi tầng chỉ kiểm tra phần của mình.',
        diagram: {
          type: 'layers',
          layers: [
            { label: 'Giao diện', items: ['Màn hình nhập', 'Biểu mẫu'] },
            { label: 'Dịch vụ', items: ['Kiểm quyền ghi', 'Ghi nhật ký'] },
            { label: 'Kho dữ liệu', items: ['Bảng dòng mới', 'Sổ riêng'] },
          ],
        },
      },
    ],
  },
});
