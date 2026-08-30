import { Module } from '@nestjs/common';
import { CashInService } from './application/cash-in.service.ts';
import { CASH_IN_STORE } from './application/ports/cash-in-store.port.ts';
import { PAYMENT_PROVIDER } from './application/ports/payment-provider.port.ts';
import { PostgresCashInStore } from './infrastructure/persistence/postgres-cash-in.store.ts';
import { FakePaymentProvider } from './infrastructure/payment/fake-payment-provider.adapter.ts';
import { CashInController } from './presentation/cash-in.controller.ts';
import { PaymentWebhookController } from './presentation/payment-webhook.controller.ts';
import { WebhookSignatureVerifier } from './infrastructure/payment/webhook-signature-verifier.ts';

@Module({
  controllers: [CashInController, PaymentWebhookController],
  providers: [
    CashInService,
    WebhookSignatureVerifier,
    { provide: CASH_IN_STORE, useClass: PostgresCashInStore },
    { provide: PAYMENT_PROVIDER, useClass: FakePaymentProvider },
  ],
})
export class CashInModule {}
