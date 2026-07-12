import { App as AntApp } from 'antd';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@/api/client';

export function useApiErrorHandler() {
  const { t, i18n } = useTranslation();
  const { message } = AntApp.useApp();

  return (error: unknown) => {
    if (error instanceof ApiError) {
      const text = error.localized(i18n.language);
      void message.error(
        error.requestId ? `${text} (${t('app.requestId')}: ${error.requestId})` : text,
      );
      return;
    }
    void message.error(t('app.error'));
  };
}
