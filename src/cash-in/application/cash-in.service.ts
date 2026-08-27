import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { decimalToMinorUnits, normalizeCurrency } from '../domain/money.js';
import { requestFingerprint } from '../domain/request-fingerprint.js';
import { CorrelationContext } from '../../shared/observability/correlation-context.js';
import {
  CASH_IN_STORE,
  type CashInStorePort,
} from './ports/cash-in-store.port.js';
import {
  PAYMENT_PROVIDER,
  type PaymentProviderPort,
} from './ports/payment-provider.port.js';

export interface CashInCommand {
  idempotencyKey: string;
  userId: string;
  amount: string;
  currency: string;
  paymentMethod: string;
}

export interface CashInResponse {
  operation_id: string;
  status: string;
  amount: number;
  new_balance?: number;
  error_code?: string;
}

@Injectable()
export class CashInService {
  constructor(
    @Inject(CASH_IN_STORE) private readonly store: CashInStorePort,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProviderPort,
    private readonly correlation: CorrelationContext,
  ) {}

  async execute(command: CashInCommand): Promise<CashInResponse> {
    const amountMinor = decimalToMinorUnits(command.amount);
    const currency = normalizeCurrency(command.currency);
    const fingerprint = requestFingerprint({
      userId: command.userId,
      amountMinor,
      currency,
      paymentMethod: command.paymentMethod,
    });
    const claim = await this.store.createOrGet({
      operationId: randomUUID(),
      idempotencyKey: command.idempotencyKey,
      requestFingerprint: fingerprint,
      providerRequestKey: randomUUID(),
      userId: command.userId,
      amountMinor,
      currency,
      paymentMethod: command.paymentMethod,
    });
    if (claim.operation.requestFingerprint !== fingerprint) {
      throw new ConflictException(
        'Idempotency key is already used for another request',
      );
    }
    if (claim.authorized) {
      await this.store.markPaymentRequested(claim.operation.operationId);
      await this.provider.charge({
        operationId: claim.operation.operationId,
        providerRequestKey: claim.operation.providerRequestKey,
        amountMinor,
        currency,
        paymentMethod: command.paymentMethod,
        correlationId: this.correlation.getId(),
      });
    }
    const operation =
      (await this.store.getById(claim.operation.operationId)) ??
      claim.operation;
    return {
      operation_id: operation.operationId,
      status: operation.status.toLowerCase(),
      amount: Number(amountMinor) / 100,
    };
  }
}
