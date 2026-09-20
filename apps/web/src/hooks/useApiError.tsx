import { App as AntApp, Typography } from 'antd';
import type { FormInstance } from 'antd/es/form';
import type { NamePath } from 'antd/es/form/interface';
import { useTranslation } from 'react-i18next';
import { normalizeApiError } from '@/api/client';

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
 * Toast API errors with a stable OVN id and docs link.
 * Pass an Ant Form instance to map VALIDATION_FAILED issues onto fields.
 */
export function useApiErrorHandler(form?: FormInstance) {
  const { t, i18n } = useTranslation();
  const { message } = AntApp.useApp();

  return (error: unknown): void => {
    const apiError = normalizeApiError(error);
    const conflictDetail = conflictDetailMessage(apiError.details, i18n.language);
    let text = conflictDetail ?? apiError.localized(i18n.language);
    const issues =
      apiError.code === 'VALIDATION_FAILED' ? allValidationIssues(apiError.details) : [];
    const extraIssues = issues
      .filter((issue) => issue.path && issue.message)
      .map((issue) => t('app.validationDetails', { path: issue.path, message: issue.message }));
    if (!conflictDetail && extraIssues.length > 0) {
      text = `${text} — ${extraIssues.join('; ')}`;
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

    void message.error({
      key: apiError.id,
      duration: 12,
      content: (
        <span>
          <div>{text}</div>
          <div>
            <Typography.Text copyable={{ text: apiError.id }}>{apiError.id}</Typography.Text>
            {' · '}
            <a href={apiError.docsUrl} target="_blank" rel="noopener noreferrer">
              {t('app.errorHelp')}
            </a>
            {apiError.requestId ? ` · ${t('app.requestId')}: ${apiError.requestId}` : null}
          </div>
        </span>
      ),
    });
  };
}
