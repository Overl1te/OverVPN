import { randomUUID } from 'node:crypto';
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
import { BigIntSerializationInterceptor } from './common/bigint-serialization';
import type { AppEnvironment } from './config/environment';
import { validateEnvironment } from './config/environment';
import { CoreModule } from './core/core.module';
import { HealthModule } from './health/health.module';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { InboundsModule } from './inbounds/inbounds.module';
import { PlansModule } from './plans/plans.module';
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
            ],
            censor: '[REDACTED]',
          },
          transport:
            config.get('NODE_ENV', { infer: true }) === 'development'
              ? {
                  target: 'pino-pretty',
                  options: {
                    colorize: true,
                    singleLine: true,
                    translateTime: 'SYS:standard',
                  },
                }
              : undefined,
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
    AuditModule,
    CoreModule,
    AuthModule,
    UsersModule,
    PlansModule,
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
