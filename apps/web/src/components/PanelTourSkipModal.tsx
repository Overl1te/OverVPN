import { Button, Modal, Space } from 'antd';
import { useTranslation } from 'react-i18next';

type Props = {
  open: boolean;
  onSkipStep: () => void;
  onCancel: () => void;
  onSkipAll: () => void;
};

export function PanelTourSkipModal({ open, onSkipStep, onCancel, onSkipAll }: Props) {
  const { t } = useTranslation();

  return (
    <Modal
      open={open}
      title={t('tour.skipConfirmTitle')}
      onCancel={onCancel}
      footer={
        <Space wrap style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button onClick={onSkipStep}>{t('tour.skipStep')}</Button>
          <Button onClick={onCancel}>{t('tour.skipCancel')}</Button>
          <Button danger type="primary" onClick={onSkipAll}>
            {t('tour.skipAll')}
          </Button>
        </Space>
      }
      destroyOnClose
      zIndex={1200}
    >
      <p style={{ margin: 0 }}>{t('tour.skipConfirmBody')}</p>
    </Modal>
  );
}
