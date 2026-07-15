import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  API_PREFIX,
  API_VERSION,
  PRODUCT_NAME,
} from '@overvpn/shared/constants';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import type { AppEnvironment } from './config/environment';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  const config = app.get(ConfigService<AppEnvironment, true>);
  const logger = app.get(Logger);

  app.useLogger(logger);
  app.flushLogs();
  app.setGlobalPrefix(API_PREFIX.slice(1));
  app.use(cookieParser());
  app.use(
    helmet({
      contentSecurityPolicy: false,
    }),
  );
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Accept',
      'Authorization',
      'Content-Type',
      'X-Request-ID',
      'X-OverVPN-Support',
    ],
    exposedHeaders: [
      'X-Request-ID',
      'subscription-userinfo',
      'profile-update-interval',
      'profile-title',
      'announce',
      'support-url',
      'profile-web-page-url',
      'providerid',
      'sub-info-text',
      'sub-info-color',
      'sub-info-button-text',
      'sub-info-button-link',
      'sub-expire',
      'sub-expire-button-link',
      'fallback-url',
      'color-profile',
      'Content-Disposition',
      'RateLimit-Limit',
      'RateLimit-Remaining',
      'RateLimit-Reset',
      'RateLimit-Policy',
      'Retry-After',
    ],
    maxAge: 86_400,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: false,
      },
    }),
  );

  if (config.get('TRUST_PROXY', { infer: true })) {
    app.set('trust proxy', 1);
  }

  if (config.get('SWAGGER_ENABLED', { infer: true })) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle(`${PRODUCT_NAME} API`)
      .setDescription('API панели управления однонодовым VPN')
      .setVersion(API_VERSION)
      .addBearerAuth()
      .addCookieAuth(
        config.get('AUTH_COOKIE_NAME', { infer: true }),
        {
          type: 'apiKey',
          in: 'cookie',
        },
        'overvpn_refresh',
      )
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup(`${API_PREFIX.slice(1)}/docs`, app, document, {
      jsonDocumentUrl: `${API_PREFIX.slice(1)}/docs-json`,
      swaggerOptions: {
        persistAuthorization: false,
      },
    });
  }

  app.enableShutdownHooks();

  const host = config.get('HOST', { infer: true });
  const port = config.get('PORT', { infer: true });
  await app.listen(port, host);
  logger.log(
    `${PRODUCT_NAME} API listening on http://${host}:${port}${API_PREFIX}`,
  );
}

void bootstrap().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`API bootstrap failed: ${message}\n`);
  process.exitCode = 1;
});
