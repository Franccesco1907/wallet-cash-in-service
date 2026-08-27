import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { decimalToMinorUnits, normalizeCurrency } from '../domain/money.js';
import { requestFingerprint } from '../domain/request-fingerprint.js';
import { CorrelationContext } from '../../shared/observability/correlation-context.js';
import {
  CASH_IN_STORE,
  PROVIDER_EVENT_DECISION,
  type CashInStorePort,
} from './ports/cash-in-store.port.js';
import {
  PAYMENT_PROVIDER,
  PROVIDER_RESULT,
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

export interface CashInExecution {
  httpStatus: number;
  response: CashInResponse;
}

export interface PaymentWebhookCommand {
  eventId: string;
  operationId: string;
  eventType: string;
  sequence: bigint;
  providerPaymentId: string;
  payloadHash: string;
}

@Injectable()
export class CashInService {
  constructor(
    @Inject(CASH_IN_STORE) private readonly store: CashInStorePort,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProviderPort,
    private readonly correlation: CorrelationContext,
  ) {}

  async execute(command: CashInCommand): Promise<CashInExecution> {
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
      const result = await this.provider.charge({
        operationId: claim.operation.operationId,
        providerRequestKey: claim.operation.providerRequestKey,
        amountMinor,
        currency,
        paymentMethod: command.paymentMethod,
        correlationId: this.correlation.getId(),
      });
      if (result.kind === PROVIDER_RESULT.SUCCESS && result.providerPaymentId) {
        await this.store.finalizeCompleted(
          claim.operation.operationId,
          result.providerPaymentId,
        );
      } else if (result.kind === PROVIDER_RESULT.REJECTED) {
        await this.store.markFailed(
          claim.operation.operationId,
          result.failureCode ?? 'PAYMENT_DECLINED',
        );
      } else {
        await this.store.markAwaitingConfirmation(claim.operation.operationId);
      }
    }
    const operation =
      (await this.store.getById(claim.operation.operationId)) ??
      claim.operation;
    const response: CashInResponse = {
      operation_id: operation.operationId,
      status: operation.status.toLowerCase(),
      amount: Number(amountMinor) / 100,
    };
    if (operation.completedBalanceMinor !== null) {
      response.new_balance = Number(operation.completedBalanceMinor) / 100;
    }
    if (operation.failureCode !== null)
      response.error_code = operation.failureCode;
    return {
      httpStatus:
        operation.status === 'COMPLETED'
          ? 200
          : operation.status === 'FAILED'
            ? 422
            : 202,
      response,
    };
  }

  async handleSuccessfulWebhook(command: PaymentWebhookCommand): Promise<void> {
    const decision = await this.store.recordProviderEvent({
      eventId: command.eventId,
      operationId: command.operationId,
      eventType: command.eventType,
      sequence: command.sequence,
      payloadHash: command.payloadHash,
    });
    if (decision === PROVIDER_EVENT_DECISION.PROCESS) {
      await this.store.finalizeCompleted(
        command.operationId,
        command.providerPaymentId,
      );
    }
  }
}
