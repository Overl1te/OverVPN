import { Test } from '@nestjs/testing';
import {
  HealthController,
  HealthService,
  type LivenessResponseDto,
  type ReadinessResponseDto,
} from './health.module';

describe('HealthController', () => {
  const liveness: LivenessResponseDto = {
    status: 'ok',
    service: 'api',
    version: '0.1.0',
    timestamp: '2026-07-12T00:00:00.000Z',
  };
  const readiness: ReadinessResponseDto = {
    status: 'ok',
    timestamp: '2026-07-12T00:00:00.000Z',
    checks: {
      database: { status: 'up', latencyMs: 1 },
      redis: { status: 'up', latencyMs: 1 },
    },
  };
  const healthService = {
    getLiveness: jest.fn(() => liveness),
    getReadiness: jest.fn(() => Promise.resolve(readiness)),
  };

  let controller: HealthController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: healthService }],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  it('returns a liveness response without dependencies', () => {
    expect(controller.getLiveness()).toEqual(liveness);
  });

  it('returns the dependency readiness response', async () => {
    await expect(controller.getReadiness()).resolves.toEqual(readiness);
  });
});
