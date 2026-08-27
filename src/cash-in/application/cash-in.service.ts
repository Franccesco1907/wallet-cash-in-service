import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  decimalToMinorUnits,
  minorUnitsToDecimal,
  normalizeCurrency,
} from '../domain/money.js';
import { OPERATION_STATE } from '../domain/operation-state.js';
import { requestFingerprint } from '../domain/request-fingerprint.js';
import { CorrelationContext } from '../../shared/observability/correlation-context.js';
import {
  CASH_IN_STORE,
  PROVIDER_EVENT_DECISION,
  type CashInOperation,
  type CashInStorePort,
} from './ports/cash-in-store.port.js';
import {
  PAYMENT_PROVIDER,
  PROVIDER_RESULT,
  type ChargeResult,
  type PaymentProviderPort,
} from './ports/payment-provider.port.js';

export const PAYMENT_EVENT_TYPE = {
  SUCCEEDED: 'payment.succeeded',
  FAILED: 'payment.failed',
} as const;

export type PaymentEventType =
  (typeof PAYMENT_EVENT_TYPE)[keyof typeof PAYMENT_EVENT_TYPE];

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
  amount: string;
  new_balance?: string;
  error_code?: string;
}

export interface CashInExecution {
  httpStatus: number;
  response: CashInResponse;
}

export interface PaymentWebhookCommand {
  eventId: string;
  operationId: string;
  eventType: PaymentEventType;
  sequence: bigint;
  providerPaymentId: string;
  payloadHash: string;
  failureCode: string | null;
}

@Injectable()
export class CashInService {
  private readonly logger = new Logger(CashInService.name);

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
    this.logger.log({
      event: claim.authorized ? 'cash_in_claimed' : 'cash_in_replayed',
      operation_id: claim.operation.operationId,
      correlation_id: this.correlation.getId(),
      idempotency_key_hash: createHash('sha256')
        .update(command.idempotencyKey)
        .digest('hex')
        .slice(0, 16),
    });
    const claimedForCharge =
      (claim.authorized ||
        claim.operation.status === OPERATION_STATE.CREATED) &&
      (await this.store.markPaymentRequested(claim.operation.operationId));
    if (claimedForCharge) {
      const result = await this.safeCharge(
        claim.operation,
        amountMinor,
        currency,
      );
      await this.applyProviderResult(claim.operation.operationId, result);
    } else if (
      claim.operation.status === OPERATION_STATE.PAYMENT_REQUESTED ||
      claim.operation.status === OPERATION_STATE.AWAITING_CONFIRMATION
    ) {
      const result = await this.safeGetStatus(
        claim.operation.providerRequestKey,
      );
      await this.applyProviderResult(claim.operation.operationId, result);
    }
    const operation =
      (await this.store.getById(claim.operation.operationId)) ??
      claim.operation;
    const response: CashInResponse = {
      operation_id: operation.operationId,
      status: operation.status.toLowerCase(),
      amount: minorUnitsToDecimal(amountMinor),
    };
    if (operation.completedBalanceMinor !== null) {
      response.new_balance = minorUnitsToDecimal(
        operation.completedBalanceMinor,
      );
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

  async handlePaymentWebhook(command: PaymentWebhookCommand): Promise<void> {
    const decision = await this.store.recordProviderEvent({
      eventId: command.eventId,
      operationId: command.operationId,
      eventType: command.eventType,
      sequence: command.sequence,
      payloadHash: command.payloadHash,
      providerPaymentId: command.providerPaymentId,
    });
    if (decision === PROVIDER_EVENT_DECISION.MISMATCH) {
      throw new ConflictException('Webhook event identity mismatch');
    }
    if (decision === PROVIDER_EVENT_DECISION.PROCESS) {
      if (command.eventType === PAYMENT_EVENT_TYPE.SUCCEEDED) {
        await this.store.finalizeCompleted(
          command.operationId,
          command.providerPaymentId,
        );
      } else {
        await this.store.markFailed(
          command.operationId,
          command.failureCode ?? 'PAYMENT_DECLINED',
        );
      }
      await this.store.markProviderEventProcessed(command.eventId);
    }
  }

  private async safeCharge(
    operation: CashInOperation,
    amountMinor: bigint,
    currency: string,
  ): Promise<ChargeResult> {
    try {
      return await this.provider.charge({
        operationId: operation.operationId,
        providerRequestKey: operation.providerRequestKey,
        amountMinor,
        currency,
        paymentMethod: operation.paymentMethod,
        correlationId: this.correlation.getId(),
      });
    } catch (error: unknown) {
      this.logger.warn({
        event: 'provider_charge_outcome_unknown',
        operation_id: operation.operationId,
        correlation_id: this.correlation.getId(),
        error_type: error instanceof Error ? error.name : 'UnknownError',
      });
      return {
        kind: PROVIDER_RESULT.UNKNOWN,
        providerPaymentId: null,
        failureCode: null,
      };
    }
  }

  private async safeGetStatus(
    providerRequestKey: string,
  ): Promise<ChargeResult> {
    try {
      return await this.provider.getStatus(providerRequestKey);
    } catch {
      return {
        kind: PROVIDER_RESULT.UNKNOWN,
        providerPaymentId: null,
        failureCode: null,
      };
    }
  }

  private async applyProviderResult(
    operationId: string,
    result: ChargeResult,
  ): Promise<void> {
    if (result.kind === PROVIDER_RESULT.SUCCESS && result.providerPaymentId) {
      await this.store.finalizeCompleted(operationId, result.providerPaymentId);
    } else if (result.kind === PROVIDER_RESULT.REJECTED) {
      await this.store.markFailed(
        operationId,
        result.failureCode ?? 'PAYMENT_DECLINED',
      );
    } else {
      await this.store.markAwaitingConfirmation(operationId);
    }
  }
}
