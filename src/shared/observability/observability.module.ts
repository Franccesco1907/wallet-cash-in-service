import {
  Global,
  MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';
import { CorrelationContext } from './correlation-context.ts';

@Global()
@Module({
  providers: [CorrelationContext],
  exports: [CorrelationContext],
})
export class ObservabilityModule implements NestModule {
  constructor(private readonly correlation: CorrelationContext) {}

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(this.correlation.use.bind(this.correlation)).forRoutes('*');
  }
}
