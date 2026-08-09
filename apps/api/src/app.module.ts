import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BackupsModule } from './backups/backups.module';
import { ApiExceptionFilter } from './common/api-error';
import { JwtAuthenticationGuard, RolesGuard } from './common/authorization';
import { SupportIntegrityGuard } from './common/support-integrity';
import { SupportIntegrityModule } from './common/support-integrity.module';
import { BigIntSerializationInterceptor } from './common/bigint-serialization';
import {
  redactLogData,
  shouldLogRequestBody,
} from './common/log-redact';
import type { AppEnvironment } from './config/environment';
import { validateEnvironment } from './config/environment';
import { CoreModule } from './core/core.module';
import { HealthModule } from './health/health.module';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { InboundsModule } from './inbounds/inbounds.module';
import { PlansModule } from './plans/plans.module';
import { ProxyServersModule } from './proxy-servers/proxy-servers.module';
import { AgentModule } from './agent/agent.module';
import { SettingsModule } from './settings/settings.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { SystemModule } from './system/system.module';
import { UsersModule } from './users/users.module';
import { WorkersModule } from './workers/workers.module';

const requestIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requestId(request: IncomingMessage, response: ServerResponse): string {
  const incoming = request.headers['x-request-id'];
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  const id =
    candidate && requestIdPattern.test(candidate) ? candidate : randomUUID();
  response.setHeader('X-Request-ID', id);
  return id;
}

type RequestWithBody = IncomingMessage & { body?: unknown };

function buildPinoTransport(
  nodeEnv: string,
  logDir: string | undefined,
  retentionDays: number,
) {
  if (nodeEnv === 'development') {
    return {
      target: 'pino-pretty',
      options: {
        colorize: true,
        singleLine: true,
        translateTime: 'SYS:standard',
      },
    };
  }

  const targets: Array<{
    target: string;
    options: Record<string, unknown>;
    level?: string;
  }> = [
    {
      target: 'pino/file',
      options: { destination: 1 },
    },
  ];

  if (logDir) {
    targets.push({
      target: 'pino-roll',
      options: {
        file: join(logDir, 'api'),
        frequency: 'daily',
        mkdir: true,
        dateFormat: 'yyyy-MM-dd',
        extension: '.log',
        limit: {
          count: Math.max(1, retentionDays - 1),
          removeOtherLogFiles: true,
        },
      },
    });
  }

  return { targets };
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: false,
      envFilePath: ['../../.env', '.env'],
      validate: validateEnvironment,
    }),
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnvironment, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          genReqId: requestId,
          autoLogging: {
            ignore: (request) =>
              /^\/api\/sub\/[^/?]+(?:\/info)?(?:\?|$)/.test(request.url ?? ''),
          },
          customProps: (request: IncomingMessage) => {
            const withBody = request as RequestWithBody;
            if (!shouldLogRequestBody(withBody.method)) {
              return {};
            }
            return {
              reqBody: redactLogData(withBody.body),
            };
          },
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.params.token',
              'req.body.password',
              'req.body.currentPassword',
              'req.body.newPassword',
              'req.body.totpCode',
              'req.body.currentTotpCode',
              'req.body.secret',
              'req.body.accessToken',
              'req.body.refreshToken',
              'req.body.settings.obfs.password',
              'req.body.settings.tls.certificatePem',
              'req.body.settings.tls.privateKeyPem',
              'req.body.settings.tls.externalAccount.macKey',
              'req.body.settings.tls.dns01Challenge.accessKeySecret',
              'req.body.settings.tls.dns01Challenge.securityToken',
              'req.body.settings.tls.dns01Challenge.apiToken',
              'req.body.settings.tls.dns01Challenge.zoneToken',
              'req.body.settings.tls.dns01Challenge.password',
              'res.body.uri',
              'res.body.password',
              'res.headers["set-cookie"]',
              'reqBody.password',
              'reqBody.currentPassword',
              'reqBody.newPassword',
              'reqBody.totpCode',
              'reqBody.secret',
              'reqBody.accessToken',
              'reqBody.refreshToken',
              'reqBody.nodeToken',
              'reqBody.installToken',
            ],
            censor: '[REDACTED]',
          },
          transport: buildPinoTransport(
            config.get('NODE_ENV', { infer: true }),
            config.get('LOG_DIR', { infer: true }),
            config.get('LOG_RETENTION_DAYS', { infer: true }),
          ),
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnvironment, true>) => [
        {
          ttl: config.get('LOGIN_THROTTLE_TTL_MS', { infer: true }),
          limit: config.get('LOGIN_THROTTLE_LIMIT', { infer: true }),
        },
      ],
    }),
    InfrastructureModule,
    SupportIntegrityModule,
    AuditModule,
    CoreModule,
    AuthModule,
    UsersModule,
    PlansModule,
    ProxyServersModule,
    AgentModule,
    InboundsModule,
    SubscriptionsModule,
    WorkersModule,
    SystemModule,
    SettingsModule,
    BackupsModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthenticationGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: SupportIntegrityGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: BigIntSerializationInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: ApiExceptionFilter,
    },
  ],
})
export class AppModule {}
