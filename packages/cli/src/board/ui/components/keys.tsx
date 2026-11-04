import { useT } from '../i18n/context.ts';

const KEYS: [string, string][] = [
  ['j / k', 'Luồng sau / trước'],
  ['Enter', 'Mở chi tiết'],
  ['e', 'Các bước hoặc mọi sự kiện'],
  ['Esc', 'Đóng'],
  ['?', 'Bảng này'],
];

export const Keys = (props: { open: boolean }) => {
  const t = useT();

  return (
    <div className="keys" id="keys" hidden={!props.open} role="dialog" aria-label={t('Phím tắt')}>
      <h2>
        <span>{t('Phím tắt')}</span>
      </h2>
      <dl>
        {KEYS.flatMap(([key, text]) => [
          <dt key={key}>{key}</dt>,
          <dd key={text}>
            <span>{t(text)}</span>
          </dd>,
        ])}
      </dl>
    </div>
  );
};
