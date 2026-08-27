import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { CashInService } from './application/cash-in.service.js';
import { CASH_IN_STORE } from './application/ports/cash-in-store.port.js';
import { PAYMENT_PROVIDER } from './application/ports/payment-provider.port.js';
import { PostgresCashInStore } from './infrastructure/persistence/postgres-cash-in.store.js';
import { FakePaymentProvider } from './infrastructure/payment/fake-payment-provider.adapter.js';
import { CashInController } from './presentation/cash-in.controller.js';
import { CorrelationContext } from '../shared/observability/correlation-context.js';
import { PaymentWebhookController } from './presentation/payment-webhook.controller.js';
import { WebhookSignatureVerifier } from './infrastructure/payment/webhook-signature-verifier.js';

@Module({
  controllers: [CashInController, PaymentWebhookController],
  providers: [
    CashInService,
    CorrelationContext,
    WebhookSignatureVerifier,
    { provide: CASH_IN_STORE, useClass: PostgresCashInStore },
    { provide: PAYMENT_PROVIDER, useClass: FakePaymentProvider },
  ],
})
export class CashInModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationContext).forRoutes('*');
  }
}
