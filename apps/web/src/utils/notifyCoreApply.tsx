import type { MessageInstance } from 'antd/es/message/interface';
import type { CoreApplySummary } from '@overvpn/shared/schemas';
import type { TFunction } from 'i18next';
import type { NavigateFunction } from 'react-router-dom';

export type NotifyCoreApplyResult = {
  /** True when the drawer/modal can safely close after save. */
  ok: boolean;
};

/**
 * Surfaces core apply outcome after inbound/assignment mutations.
 * Returns ok=false for FAILED / PARTIAL_SUCCEEDED so the editor can stay open.
 */
export function notifyCoreApply(
  apply: CoreApplySummary,
  options: {
    t: TFunction;
    messageApi: MessageInstance;
    navigate?: NavigateFunction;
  },
): NotifyCoreApplyResult {
  const { t, messageApi, navigate } = options;
  const errorDetail = apply.error?.trim() || apply.rollbackOutcome?.trim() || '';

  if (apply.status === 'SUCCEEDED') {
    void messageApi.success(t('coreApply.succeeded'));
    return { ok: true };
  }

  if (apply.status === 'PARTIAL_SUCCEEDED') {
    const text = errorDetail
      ? t('coreApply.partialWithError', { error: errorDetail })
      : t('coreApply.partial');
    void messageApi.warning({
      content: (
        <span>
          {text}{' '}
          {navigate ? (
            <a
              onClick={(event) => {
                event.preventDefault();
                navigate('/config');
              }}
            >
              {t('coreApply.openConfig')}
            </a>
          ) : null}
        </span>
      ),
      duration: 10,
    });
    return { ok: false };
  }

  if (apply.status === 'FAILED') {
    const text = errorDetail
      ? t('coreApply.failedWithError', { error: errorDetail })
      : t('coreApply.failed');
    void messageApi.error({
      content: (
        <span>
          {text}{' '}
          {navigate ? (
            <a
              onClick={(event) => {
                event.preventDefault();
                navigate('/config');
              }}
            >
              {t('coreApply.openConfig')}
            </a>
          ) : null}
        </span>
      ),
      duration: 12,
    });
    return { ok: false };
  }

  void messageApi.warning({
    content: (
      <span>
        {t('coreApply.pending', { status: apply.status })}{' '}
        {navigate ? (
          <a
            onClick={(event) => {
              event.preventDefault();
              navigate('/config');
            }}
          >
            {t('coreApply.openConfig')}
          </a>
        ) : null}
      </span>
    ),
    duration: 8,
  });
  return { ok: false };
}
