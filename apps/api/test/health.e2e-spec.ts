import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { HealthController, HealthService } from '../src/health/health.module';

describe('health endpoints (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthService,
          useValue: {
            getLiveness: () => ({
              status: 'ok',
              service: 'api',
              version: '0.1.0',
              timestamp: '2026-07-12T00:00:00.000Z',
            }),
            getReadiness: () =>
              Promise.resolve({
                status: 'ok',
                timestamp: '2026-07-12T00:00:00.000Z',
                checks: {
                  database: { status: 'up', latencyMs: 1 },
                  redis: { status: 'up', latencyMs: 1 },
                },
              }),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health returns liveness', async () => {
    await request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          status: 'ok',
          service: 'api',
        });
      });
  });

  it('GET /api/health/ready returns mocked dependency state', async () => {
    await request(app.getHttpServer())
      .get('/api/health/ready')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          status: 'ok',
          checks: {
            database: { status: 'up' },
            redis: { status: 'up' },
          },
        });
      });
  });
});
