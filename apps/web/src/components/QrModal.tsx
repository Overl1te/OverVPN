import { Modal } from 'antd';
import { QRCodeSVG } from 'qrcode.react';
import { useTranslation } from 'react-i18next';
import { CopyButton } from './CopyButton';

export function QrModal({
  open,
  value,
  onClose,
}: {
  open: boolean;
  value: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal open={open} onCancel={onClose} footer={null} title={t('app.showQr')} destroyOnClose>
      <div style={{ display: 'grid', gap: 12, justifyItems: 'center' }}>
        <QRCodeSVG value={value} size={220} includeMargin />
        <div style={{ wordBreak: 'break-all', fontSize: 12 }}>{value}</div>
        <CopyButton value={value} />
      </div>
    </Modal>
  );
}
