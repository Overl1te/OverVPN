export interface LocalizedMessage {
  en: string;
  ru: string;
}

const INTERNAL_TERMS =
  /\b(sing-box|singbox|v2ray|clash api|clash_api|grpc|dns:)\b/gi;

function stripInternalTerms(text: string): string {
  return text
    .replace(INTERNAL_TERMS, 'core')
    .replace(/\bcore:\d+\b/gi, 'core service')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function localizeCoreHealthError(raw: string): LocalizedMessage {
  const normalized = stripInternalTerms(raw);
  if (/name resolution failed|unavailable|econnrefused|enotfound/i.test(raw)) {
    return {
      en: 'Core health check failed: VPN core service is not responding',
      ru: 'Проверка ядра не прошла: VPN-ядро не отвечает',
    };
  }
  if (/returned http/i.test(normalized)) {
    return {
      en: `Core health check failed: ${normalized}`,
      ru: `Проверка ядра не прошла: ${normalized}`,
    };
  }
  return {
    en: `Core health check failed: ${normalized}`,
    ru: `Проверка ядра не прошла: ${normalized}`,
  };
}

export function localizeCoreStatsError(
  code: 'UNSUPPORTED' | 'UNAVAILABLE' | 'QUERY_FAILED',
  raw: string,
): LocalizedMessage {
  if (code === 'UNSUPPORTED') {
    return {
      en: 'Core statistics are not supported by the deployed core binary',
      ru: 'Статистика ядра не поддерживается установленным бинарником ядра',
    };
  }
  if (
    code === 'UNAVAILABLE' ||
    /name resolution failed|unavailable|econnrefused|enotfound/i.test(raw)
  ) {
    return {
      en: 'Core statistics are unavailable (core service is not responding)',
      ru: 'Статистика ядра недоступна (сервис ядра не отвечает)',
    };
  }
  const normalized = stripInternalTerms(raw);
  return {
    en: `Core statistics query failed: ${normalized}`,
    ru: `Не удалось получить статистику ядра: ${normalized}`,
  };
}

export function localizeThroughputReason(
  workerName: string | undefined,
  workerState: string | undefined,
  workerError: string | null | undefined,
): LocalizedMessage {
  if (workerError) {
    const sanitized = stripInternalTerms(workerError);
    if (/unavailable:/i.test(sanitized) || /not responding/i.test(sanitized)) {
      return {
        en: 'Core statistics are unavailable (core service is not responding)',
        ru: 'Статистика ядра недоступна (сервис ядра не отвечает)',
      };
    }
    return {
      en: sanitized,
      ru: sanitized,
    };
  }
  const state = workerState ?? 'unknown';
  if (state === 'STALE') {
    return {
      en: 'Traffic collector is stale',
      ru: 'Сборщик трафика устарел',
    };
  }
  if (state === 'FAILED' || state === 'UNAVAILABLE') {
    return {
      en: 'Traffic collector is unavailable',
      ru: 'Сборщик трафика недоступен',
    };
  }
  return {
    en: `Traffic collector is ${state}`,
    ru: `Сборщик трафика: ${state}`,
  };
}

export function localizeWorkerError(raw: string | null | undefined): LocalizedMessage | null {
  if (!raw) {
    return null;
  }
  const sanitized = stripInternalTerms(raw);
  if (/unavailable:/i.test(sanitized) || /not responding/i.test(sanitized)) {
    return {
      en: 'Core statistics are unavailable (core service is not responding)',
      ru: 'Статистика ядра недоступна (сервис ядра не отвечает)',
    };
  }
  if (/invalid or did not resolve/i.test(sanitized)) {
    return {
      en: 'Some traffic counters were invalid or did not resolve to users',
      ru: 'Часть счётчиков трафика некорректна или не привязана к пользователям',
    };
  }
  return { en: sanitized, ru: sanitized };
}
