import { Alert } from 'antd';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/auth/AuthContext';
import type { ReactNode } from 'react';

/** Hide children for READONLY; optionally show a compact hint. */
export function MutateOnly({ children, hint = false }: { children: ReactNode; hint?: boolean }) {
  const { canMutate } = useAuth();
  const { t } = useTranslation();
  if (!canMutate) {
    return hint ? (
      <Alert type="info" showIcon message={t('app.readonlyHint')} style={{ marginBottom: 12 }} />
    ) : null;
  }
  return <>{children}</>;
}
