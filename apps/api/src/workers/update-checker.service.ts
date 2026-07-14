import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SystemUpdateStatus } from '@overvpn/shared/schemas';
import type { AppEnvironment } from '../config/environment';
import { RedisDistributedLock } from '../core/distributed-lock';
import { RedisService } from '../infrastructure/infrastructure.module';
import { TelegramNotificationService } from '../notifications/telegram-notification.service';
import { WorkerHealthService } from './worker-health.service';

const LOCK_KEY = 'overvpn:workers:update-checker:lock';
const STATUS_KEY = 'overvpn:updates:status';
const NOTIFIED_SHA_KEY = 'overvpn:updates:notified-sha';
const WORKER_NAME = 'update-checker' as const;

const APPLY_HINT = 'Run on the host: sudo overvpn update';
const APPLY_HINT_RU = 'На сервере выполните: sudo overvpn update';

type CachedStatus = Omit<
  SystemUpdateStatus,
  'checkEnabled' | 'applyHint' | 'applyHintRu'
>;

export type UpdateCheckResult =
  | { acquired: false }
  | {
      acquired: true;
      status: 'HEALTHY' | 'DEGRADED' | 'FAILED';
      updateAvailable: boolean;
    };

@Injectable()
export class UpdateCheckerService {
  private readonly logger = new Logger(UpdateCheckerService.name);
  private readonly workersEnabled: boolean;
  private readonly checkEnabled: boolean;
  private readonly lockTtlMs: number;
  private readonly currentSha: string | null;
  private readonly repo: string;
  private readonly ref: string;
  private readonly timeoutMs: number;
  private readonly channel: string;

  constructor(
    private readonly redis: RedisService,
    private readonly lock: RedisDistributedLock,
    private readonly health: WorkerHealthService,
    private readonly notifications: TelegramNotificationService,
    config: ConfigService<AppEnvironment, true>,
  ) {
    this.workersEnabled = config.get('WORKERS_ENABLED', { infer: true });
    this.checkEnabled = config.get('UPDATE_CHECK_ENABLED', { infer: true });
    this.lockTtlMs = config.get('WORKER_LOCK_TTL_MS', { infer: true });
    this.currentSha = normalizeSha(
      config.get('OVERVPN_GIT_SHA', { infer: true }) ?? null,
    );
    this.repo = config.get('UPDATE_CHECK_REPO', { infer: true });
    this.ref = config.get('UPDATE_CHECK_REF', { infer: true });
    this.timeoutMs = config.get('UPDATE_CHECK_TIMEOUT_MS', { infer: true });
    this.channel = `${this.repo}@${this.ref}`;
  }

  async getStatus(): Promise<SystemUpdateStatus> {
    const cached = await this.readCache();
    return this.toPublic(cached);
  }

  async checkNow(): Promise<SystemUpdateStatus> {
    await this.performCheck({ notify: true });
    return this.getStatus();
  }

  async runOnce(): Promise<UpdateCheckResult> {
    if (!this.workersEnabled || !this.checkEnabled) {
      return { acquired: false };
    }
    const startedAt = new Date();
    try {
      const attempted = await this.lock.tryWithLock(
        LOCK_KEY,
        this.lockTtlMs,
        async () => {
          await this.health.markRunning(WORKER_NAME, startedAt);
          const outcome = await this.performCheck({ notify: true });
          await this.health.markSuccess(WORKER_NAME, startedAt, {
            updateAvailable: outcome.updateAvailable,
            currentSha: outcome.currentSha,
            latestSha: outcome.latestSha,
          });
          return {
            status: 'HEALTHY' as const,
            updateAvailable: outcome.updateAvailable,
          };
        },
      );
      if (!attempted.acquired) {
        return { acquired: false };
      }
      return {
        acquired: true,
        status: attempted.value.status,
        updateAvailable: attempted.value.updateAvailable,
      };
    } catch (error: unknown) {
      const message = errorMessage(error);
      this.logger.warn(`Update check failed: ${message}`);
      await this.health.markFailure(WORKER_NAME, startedAt, error);
      await this.writeCache({
        checkedAt: new Date().toISOString(),
        updateAvailable: false,
        currentSha: this.currentSha,
        latestSha: null,
        latestShortSha: null,
        latestHtmlUrl: null,
        channel: this.channel,
        currentKnown: this.currentSha !== null,
        error: message,
        errorRu: 'Не удалось проверить обновления',
      });
      return { acquired: true, status: 'FAILED', updateAvailable: false };
    }
  }

  private async performCheck(input: {
    notify: boolean;
  }): Promise<CachedStatus> {
    const checkedAt = new Date().toISOString();
    if (!this.checkEnabled) {
      const disabled: CachedStatus = {
        checkedAt,
        updateAvailable: false,
        currentSha: this.currentSha,
        latestSha: null,
        latestShortSha: null,
        latestHtmlUrl: null,
        channel: this.channel,
        currentKnown: this.currentSha !== null,
        error: 'Update checks are disabled',
        errorRu: 'Проверка обновлений отключена',
      };
      await this.writeCache(disabled);
      return disabled;
    }

    if (!this.currentSha) {
      const unknown: CachedStatus = {
        checkedAt,
        updateAvailable: false,
        currentSha: null,
        latestSha: null,
        latestShortSha: null,
        latestHtmlUrl: null,
        channel: this.channel,
        currentKnown: false,
        error:
          'Current build has no OVERVPN_GIT_SHA (local image without bake)',
        errorRu:
          'В текущем образе нет OVERVPN_GIT_SHA (локальная сборка без git sha)',
      };
      await this.writeCache(unknown);
      return unknown;
    }

    const remote = await this.fetchLatestCommit();
    const updateAvailable = !shaEquals(this.currentSha, remote.sha);
    const cached: CachedStatus = {
      checkedAt,
      updateAvailable,
      currentSha: this.currentSha,
      latestSha: remote.sha,
      latestShortSha: remote.sha.slice(0, 7),
      latestHtmlUrl: remote.htmlUrl,
      channel: this.channel,
      currentKnown: true,
      error: null,
      errorRu: null,
    };
    await this.writeCache(cached);

    if (input.notify && updateAvailable) {
      await this.notifyIfNew(remote.sha, remote.htmlUrl);
    }
    return cached;
  }

  private async fetchLatestCommit(): Promise<{
    sha: string;
    htmlUrl: string;
  }> {
    const url = `https://api.github.com/repos/${this.repo}/commits/${encodeURIComponent(this.ref)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    timeout.unref();
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'OverVPN-UpdateChecker',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = (await response.text()).replace(/\s+/g, ' ').slice(0, 300);
        throw new Error(`GitHub returned HTTP ${response.status}: ${body}`);
      }
      const raw = await response.text();
      const payload = JSON.parse(raw) as {
        sha?: unknown;
        html_url?: unknown;
      };
      const sha = normalizeSha(
        typeof payload.sha === 'string' ? payload.sha : null,
      );
      if (!sha) {
        throw new Error('GitHub commit response missing sha');
      }
      const htmlUrl =
        typeof payload.html_url === 'string' && payload.html_url.length > 0
          ? payload.html_url
          : `https://github.com/${this.repo}/commit/${sha}`;
      return { sha, htmlUrl };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async notifyIfNew(sha: string, htmlUrl: string): Promise<void> {
    const client = this.redis.getClient();
    const previous = await client.get(NOTIFIED_SHA_KEY);
    if (previous && shaEquals(previous, sha)) {
      return;
    }
    await this.notifications.notifyUpdateAvailable({
      currentSha: this.currentSha!,
      latestSha: sha,
      latestHtmlUrl: htmlUrl,
      channel: this.channel,
    });
    await client.set(NOTIFIED_SHA_KEY, sha);
  }

  private async readCache(): Promise<CachedStatus | null> {
    try {
      const raw = await this.redis.getClient().get(STATUS_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as CachedStatus;
      if (!parsed || typeof parsed !== 'object') {
        return null;
      }
      return parsed;
    } catch (error: unknown) {
      this.logger.warn(`Could not read update status: ${errorMessage(error)}`);
      return null;
    }
  }

  private async writeCache(status: CachedStatus): Promise<void> {
    try {
      await this.redis.getClient().set(STATUS_KEY, JSON.stringify(status));
    } catch (error: unknown) {
      this.logger.warn(`Could not store update status: ${errorMessage(error)}`);
    }
  }

  private toPublic(cached: CachedStatus | null): SystemUpdateStatus {
    return {
      checkedAt: cached?.checkedAt ?? null,
      updateAvailable: cached?.updateAvailable ?? false,
      currentSha: cached?.currentSha ?? this.currentSha,
      latestSha: cached?.latestSha ?? null,
      latestShortSha: cached?.latestShortSha ?? null,
      latestHtmlUrl: cached?.latestHtmlUrl ?? null,
      channel: cached?.channel ?? this.channel,
      checkEnabled: this.checkEnabled,
      currentKnown: cached?.currentKnown ?? this.currentSha !== null,
      error: cached?.error ?? null,
      errorRu: cached?.errorRu ?? null,
      applyHint: APPLY_HINT,
      applyHintRu: APPLY_HINT_RU,
    };
  }
}

function normalizeSha(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  if (!/^[0-9a-f]{7,40}$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function shaEquals(left: string, right: string): boolean {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  const length = Math.min(a.length, b.length);
  if (length < 7) {
    return false;
  }
  return a.slice(0, length) === b.slice(0, length);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
