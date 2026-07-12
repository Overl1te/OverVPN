import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { UserStatus } from '@overvpn/shared/constants';
import type { AppEnvironment } from '../config/environment';

@Injectable()
export class TelegramNotificationService {
  private readonly logger = new Logger(TelegramNotificationService.name);
  private readonly enabled: boolean;
  private readonly token: string | null;
  private readonly chatId: string | null;
  private readonly timeoutMs: number;

  constructor(config: ConfigService<AppEnvironment, true>) {
    this.enabled = config.get('TELEGRAM_ENABLED', { infer: true });
    this.token = config.get('TELEGRAM_BOT_TOKEN', { infer: true }) ?? null;
    this.chatId = config.get('TELEGRAM_CHAT_ID', { infer: true }) ?? null;
    this.timeoutMs = config.get('TELEGRAM_TIMEOUT_MS', { infer: true });
  }

  async notifyUserTransition(input: {
    username: string;
    previousStatus: UserStatus;
    status: UserStatus;
    reason: string | null;
  }): Promise<void> {
    const reasonEn = englishReason(input.reason);
    const reasonRu = russianReason(input.reason);
    await this.send(
      [
        `VPN user ${input.username}: ${input.previousStatus} → ${input.status}${reasonEn ? ` (${reasonEn})` : ''}.`,
        `VPN пользователь ${input.username}: ${input.previousStatus} → ${input.status}${reasonRu ? ` (${reasonRu})` : ''}.`,
      ].join('\n'),
    );
  }

  async notifyApplyFailure(input: {
    applyId: string;
    trigger: string;
    error: string | null;
  }): Promise<void> {
    const detail = sanitize(input.error ?? 'unknown error').slice(0, 500);
    await this.send(
      [
        `Core apply failed (${input.trigger}, ${input.applyId}): ${detail}`,
        `Ошибка применения конфигурации ядра (${input.trigger}, ${input.applyId}): ${detail}`,
      ].join('\n'),
    );
  }

  private async send(text: string): Promise<void> {
    if (!this.enabled || !this.token || !this.chatId) {
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    timeout.unref();
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${this.token}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: this.chatId,
            text,
            disable_web_page_preview: true,
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        const body = sanitize(await response.text()).slice(0, 500);
        throw new Error(`Telegram returned HTTP ${response.status}: ${body}`);
      }
    } catch (error: unknown) {
      const message = sanitize(
        error instanceof Error ? error.message : String(error),
      ).replaceAll(this.token, '[REDACTED]');
      this.logger.warn(`Telegram notification failed: ${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function englishReason(reason: string | null): string {
  return (
    {
      expired: 'expired',
      quota: 'quota reached',
      device: 'device limit',
      ip: 'IP limit',
    }[reason ?? ''] ?? ''
  );
}

function russianReason(reason: string | null): string {
  return (
    {
      expired: 'истёк срок',
      quota: 'исчерпана квота',
      device: 'лимит устройств',
      ip: 'лимит IP',
    }[reason ?? ''] ?? ''
  );
}

function sanitize(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
