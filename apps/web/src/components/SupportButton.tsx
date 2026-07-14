import { HeartOutlined } from '@ant-design/icons';
import { Button, Tooltip } from 'antd';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SUPPORT_MANIFEST,
  computeSupportProof,
  supportEpochDay,
} from '@overvpn/shared/support-integrity';

/**
 * Presence seal for panel mutations.
 * `apiRequest` imports proof helpers from this module so deleting the widget
 * without leaving a compatible stub breaks admin write paths client-side.
 */
let presenceEpochDay = Number.NaN;

export function markSupportPresence(): void {
  presenceEpochDay = supportEpochDay();
}

export function isSupportPresent(): boolean {
  return presenceEpochDay === supportEpochDay();
}

export async function getPanelSupportProof(): Promise<string> {
  if (!isSupportPresent()) {
    throw new Error('SUPPORT_INTEGRITY_FAILED');
  }
  return computeSupportProof();
}

export function SupportButton({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation();

  useEffect(() => {
    markSupportPresence();
    const timer = window.setInterval(() => {
      markSupportPresence();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="support-dock" {...{ [SUPPORT_MANIFEST.marker]: SUPPORT_MANIFEST.id }}>
      <Tooltip title={t('support.tooltip')} placement="right">
        <Button
          type="link"
          className="support-button"
          icon={<HeartOutlined />}
          href={SUPPORT_MANIFEST.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('support.label')}
        >
          {collapsed ? null : t('support.label')}
        </Button>
      </Tooltip>
    </div>
  );
}
