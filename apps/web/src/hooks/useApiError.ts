import { App as AntApp } from 'antd';
import type { FormInstance } from 'antd/es/form';
import type { NamePath } from 'antd/es/form/interface';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@/api/client';

type ValidationIssue = {
  path?: string;
  message?: string;
};

function allValidationIssues(details: unknown): ValidationIssue[] {
  if (!details || typeof details !== 'object') {
    return [];
  }
  const issues = (details as { issues?: unknown }).issues;
  if (!Array.isArray(issues) || issues.length === 0) {
    return [];
  }
  return issues
    .filter((item): item is object => !!item && typeof item === 'object')
    .map((item) => {
      const issue = item as ValidationIssue;
      return {
        path: typeof issue.path === 'string' ? issue.path : undefined,
        message: typeof issue.message === 'string' ? issue.message : undefined,
      };
    })
    .filter((issue) => issue.message);
}

function pathToName(path: string): NamePath {
  return path.split('.').map((segment) => {
    const asNumber = Number(segment);
    return Number.isInteger(asNumber) && String(asNumber) === segment ? asNumber : segment;
  });
}

function conflictDetailMessage(details: unknown, locale: string): string | null {
  if (!details || typeof details !== 'object') {
    return null;
  }
  const record = details as { reason?: unknown; message?: unknown; messageRu?: unknown };
  if (typeof record.reason !== 'string' || !record.reason.startsWith('inbound_listen_port_')) {
    return null;
  }
  if (locale.startsWith('ru') && typeof record.messageRu === 'string' && record.messageRu) {
    return record.messageRu;
  }
  if (typeof record.message === 'string' && record.message) {
    return record.message;
  }
  return null;
}

/**
 * Toast API errors. Pass an Ant Form instance to map VALIDATION_FAILED issues onto fields.
 * The returned handler is a single-arg function so it matches react-query `onError`.
 */
export function useApiErrorHandler(form?: FormInstance) {
  const { t, i18n } = useTranslation();
  const { message } = AntApp.useApp();

  return (error: unknown): void => {
    if (error instanceof ApiError) {
      const conflictDetail = conflictDetailMessage(error.details, i18n.language);
      let text = conflictDetail ?? error.localized(i18n.language);
      const issues = error.code === 'VALIDATION_FAILED' ? allValidationIssues(error.details) : [];
      const first = issues[0];
      if (!conflictDetail && first?.path && first.message) {
        text = `${text} — ${t('app.validationDetails', { path: first.path, message: first.message })}`;
      }

      if (form) {
        if (issues.length > 0) {
          form.setFields(
            issues
              .filter((issue): issue is ValidationIssue & { path: string; message: string } =>
                Boolean(issue.path && issue.message),
              )
              .map((issue) => ({
                name: pathToName(issue.path),
                errors: [issue.message],
              })),
          );
        } else if (conflictDetail) {
          form.setFields([
            {
              name: ['settings', 'listenPort'],
              errors: [conflictDetail],
            },
          ]);
        }
      }

      void message.error(
        error.requestId ? `${text} (${t('app.requestId')}: ${error.requestId})` : text,
      );
      return;
    }
    void message.error(t('app.error'));
  };
}
