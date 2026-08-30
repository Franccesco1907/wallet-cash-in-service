import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.ts';

export async function createTestApp(): Promise<INestApplication> {
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = module.createNestApplication({ rawBody: true });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.init();
  return app;
}
