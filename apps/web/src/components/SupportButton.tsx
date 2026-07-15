import { HeartOutlined } from '@ant-design/icons';
import { Tooltip } from 'antd';
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
    <div
      className={`support-dock${collapsed ? ' support-dock--collapsed' : ''}`}
      {...{ [SUPPORT_MANIFEST.marker]: SUPPORT_MANIFEST.id }}
    >
      <Tooltip title={t('support.tooltip')} placement="right">
        <a
          className="support-button"
          href={SUPPORT_MANIFEST.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('support.label')}
        >
          <span className="support-button__icon" aria-hidden>
            <HeartOutlined />
          </span>
          {collapsed ? null : <span className="support-button__label">{t('support.label')}</span>}
        </a>
      </Tooltip>
    </div>
  );
}
