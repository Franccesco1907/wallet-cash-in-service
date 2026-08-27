import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CashInModule } from './cash-in/cash-in.module.js';
import { parseEnvironment } from './config/environment.js';

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
    CashInModule,
  ],
})
export class AppModule {}
