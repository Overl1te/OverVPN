import { App as AntApp } from 'antd';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@/api/client';

type ValidationIssue = {
  path?: string;
  message?: string;
};

function firstValidationIssue(details: unknown): ValidationIssue | null {
  if (!details || typeof details !== 'object') {
    return null;
  }
  const issues = (details as { issues?: unknown }).issues;
  if (!Array.isArray(issues) || issues.length === 0) {
    return null;
  }
  const first = issues[0];
  if (!first || typeof first !== 'object') {
    return null;
  }
  const issue = first as ValidationIssue;
  return {
    path: typeof issue.path === 'string' ? issue.path : undefined,
    message: typeof issue.message === 'string' ? issue.message : undefined,
  };
}

export function useApiErrorHandler() {
  const { t, i18n } = useTranslation();
  const { message } = AntApp.useApp();

  return (error: unknown) => {
    if (error instanceof ApiError) {
      let text = error.localized(i18n.language);
      const issue = error.code === 'VALIDATION_FAILED' ? firstValidationIssue(error.details) : null;
      if (issue?.path && issue.message) {
        text = `${text} — ${t('app.validationDetails', { path: issue.path, message: issue.message })}`;
      }
      void message.error(
        error.requestId ? `${text} (${t('app.requestId')}: ${error.requestId})` : text,
      );
      return;
    }
    void message.error(t('app.error'));
  };
}
