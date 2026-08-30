import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CashInModule } from './cash-in/cash-in.module.ts';
import { parseEnvironment } from './config/environment.ts';
import { HttpExceptionFilter } from './shared/http/http-exception.filter.ts';
import { HttpLoggingInterceptor } from './shared/observability/http-logging.interceptor.ts';
import { ObservabilityModule } from './shared/observability/observability.module.ts';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: parseEnvironment }),
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: 'postgres' as const,
        url: parseEnvironment().DATABASE_URL,
        synchronize: false,
        autoLoadEntities: false,
      }),
    }),
    ObservabilityModule,
    CashInModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: HttpLoggingInterceptor },
  ],
})
export class AppModule {}
