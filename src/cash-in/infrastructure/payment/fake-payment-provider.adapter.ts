import { Injectable } from '@nestjs/common';
import {
  PROVIDER_RESULT,
  type ChargeInput,
  type ChargeResult,
  type PaymentProviderPort,
} from '../../application/ports/payment-provider.port.js';

@Injectable()
export class FakePaymentProvider implements PaymentProviderPort {
  private static chargeCount = 0;
  private static statusQueryCount = 0;
  private static readonly statuses = new Map<string, ChargeResult>();
  private static delayedPromise: Promise<void> | null = null;
  private static releaseDelay: (() => void) | null = null;

  static reset(): void {
    this.chargeCount = 0;
    this.statusQueryCount = 0;
    this.delayedPromise = null;
    this.releaseDelay = null;
    this.statuses.clear();
  }

  static holdDelayedResponses(): void {
    this.delayedPromise = new Promise((resolve) => {
      this.releaseDelay = resolve;
    });
  }

  static releaseDelayedResponses(): void {
    this.releaseDelay?.();
  }

  static calls(): number {
    return this.chargeCount;
  }

  static statusCalls(): number {
    return this.statusQueryCount;
  }

  static setStatus(providerRequestKey: string, result: ChargeResult): void {
    this.statuses.set(providerRequestKey, result);
  }

  async charge(input: ChargeInput): Promise<ChargeResult> {
    FakePaymentProvider.chargeCount += 1;
    if (input.paymentMethod === 'fake_throw_timeout') {
      throw new Error('simulated provider timeout');
    }
    if (input.paymentMethod === 'fake_delayed') {
      await FakePaymentProvider.delayedPromise;
      return {
        kind: PROVIDER_RESULT.SUCCESS,
        providerPaymentId: `pay_${input.operationId}`,
        failureCode: null,
      };
    }
    if (input.paymentMethod === 'fake_success') {
      return {
        kind: PROVIDER_RESULT.SUCCESS,
        providerPaymentId: `pay_${input.operationId}`,
        failureCode: null,
      };
    }
    if (input.paymentMethod === 'fake_decline') {
      return {
        kind: PROVIDER_RESULT.REJECTED,
        providerPaymentId: `pay_${input.operationId}`,
        failureCode: 'PAYMENT_DECLINED',
      };
    }
    return {
      kind: PROVIDER_RESULT.UNKNOWN,
      providerPaymentId: `pay_${input.operationId}`,
      failureCode: null,
    };
  }

  async getStatus(providerRequestKey: string): Promise<ChargeResult> {
    FakePaymentProvider.statusQueryCount += 1;
    return (
      FakePaymentProvider.statuses.get(providerRequestKey) ?? {
        kind: PROVIDER_RESULT.UNKNOWN,
        providerPaymentId: null,
        failureCode: null,
      }
    );
  }
}
