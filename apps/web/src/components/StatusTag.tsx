import { Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ProxyServerStatus, UserStatus, UserStatusReason } from '@overvpn/shared/constants';

const STATUS_COLOR: Record<UserStatus, string> = {
  ACTIVE: 'green',
  DISABLED: 'default',
  EXPIRED: 'orange',
  LIMITED: 'red',
};

const PROXY_STATUS_COLOR: Record<ProxyServerStatus, string> = {
  PENDING: 'processing',
  ONLINE: 'green',
  OFFLINE: 'default',
  ERROR: 'red',
  DISABLED: 'default',
};

export function UserStatusTag({
  status,
  reason,
}: {
  status: UserStatus;
  reason?: UserStatusReason | null;
}) {
  const { t } = useTranslation();
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <Tag color={STATUS_COLOR[status]} style={{ marginInlineEnd: 0 }}>
        {t(`enums.userStatus.${status}`)}
      </Tag>
      {reason ? (
        <Tag color="gold" style={{ marginInlineEnd: 0 }}>
          {t(`statusReason.${reason}`)}
        </Tag>
      ) : null}
    </span>
  );
}

export function ProxyServerStatusTag({ status }: { status: ProxyServerStatus }) {
  const { t } = useTranslation();
  return (
    <Tag color={PROXY_STATUS_COLOR[status]} style={{ marginInlineEnd: 0 }}>
      {t(`enums.proxyServerStatus.${status}`)}
    </Tag>
  );
}
