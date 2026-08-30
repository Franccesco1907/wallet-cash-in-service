import {
  Controller,
  Get,
  Module,
  Query,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AsyncLocalStorage } from 'node:async_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import request from 'supertest';
import { vi } from 'vitest';
import { CorrelationContext } from './correlation-context.ts';
import { ObservabilityModule } from './observability.module.ts';

@Controller('correlation-probe')
class CorrelationProbeController {
  constructor(private readonly correlation: CorrelationContext) {}

  @Get()
  async getCorrelationId(
    @Query('delay') delayMilliseconds: string | undefined,
  ): Promise<{ correlationId: string }> {
    await delay(Number(delayMilliseconds ?? 0));
    return { correlationId: this.correlation.getId() };
  }
}

@Module({ controllers: [CorrelationProbeController] })
class FeatureModuleWithoutObservabilityImport {}

@Module({
  imports: [ObservabilityModule, FeatureModuleWithoutObservabilityImport],
})
class TestAppModule {}

describe('ObservabilityModule', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('provides one global correlation context and applies it to all routes', async () => {
    const response = await request(app.getHttpServer())
      .get('/correlation-probe')
      .set('x-correlation-id', '  client.request-123  ')
      .expect(200);

    expect(response.headers['x-correlation-id']).toBe('client.request-123');
    expect(response.body).toEqual({ correlationId: 'client.request-123' });
  });

  it('disables async local storage when the application closes', async () => {
    const disable = vi.spyOn(AsyncLocalStorage.prototype, 'disable');

    try {
      await app.close();

      expect(disable).toHaveBeenCalledOnce();
    } finally {
      disable.mockRestore();
    }
  });

  it('isolates correlation IDs across overlapping asynchronous requests', async () => {
    const requestA = request(app.getHttpServer())
      .get('/correlation-probe')
      .query({ delay: 40 })
      .set('x-correlation-id', 'request-a');
    const requestB = request(app.getHttpServer())
      .get('/correlation-probe')
      .query({ delay: 5 })
      .set('x-correlation-id', 'request-b');

    const [responseA, responseB] = await Promise.all([requestA, requestB]);

    expect(responseA.body).toEqual({ correlationId: 'request-a' });
    expect(responseB.body).toEqual({ correlationId: 'request-b' });
  });
});
