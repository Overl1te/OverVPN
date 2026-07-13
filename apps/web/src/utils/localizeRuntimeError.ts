export function localizedRuntimeError(
  message: string | null | undefined,
  locale: string,
  fallbackRu?: string | null,
): string | null {
  if (!message) {
    return null;
  }
  if (locale.startsWith('ru') && fallbackRu) {
    return fallbackRu;
  }
  if (!locale.startsWith('ru')) {
    return message;
  }
  if (/core statistics are unavailable/i.test(message)) {
    return 'Статистика ядра недоступна (сервис ядра не отвечает)';
  }
  if (/core health check failed/i.test(message)) {
    return message.replace(/Core health check failed/gi, 'Проверка ядра не прошла');
  }
  if (/traffic collector is stale/i.test(message)) {
    return 'Сборщик трафика устарел';
  }
  if (/traffic collector is unavailable/i.test(message)) {
    return 'Сборщик трафика недоступен';
  }
  if (/invalid or did not resolve to users/i.test(message)) {
    return 'Часть счётчиков трафика некорректна или не привязана к пользователям';
  }
  return message;
}
