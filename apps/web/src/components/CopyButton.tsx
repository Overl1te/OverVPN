import { App as AntApp, Button } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

type Props = {
  value: string;
  label?: string;
  size?: 'small' | 'middle';
};

export function CopyButton({ value, label, size = 'small' }: Props) {
  const { t } = useTranslation();
  const { message: messageApi } = AntApp.useApp();

  return (
    <Button
      size={size}
      icon={<CopyOutlined />}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          void messageApi.success(t('app.copied'));
        } catch {
          void messageApi.error(t('app.error'));
        }
      }}
    >
      {label ?? t('app.copy')}
    </Button>
  );
}
