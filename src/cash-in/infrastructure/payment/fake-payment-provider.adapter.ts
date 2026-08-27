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

  static reset(): void {
    this.chargeCount = 0;
  }

  static calls(): number {
    return this.chargeCount;
  }

  async charge(input: ChargeInput): Promise<ChargeResult> {
    FakePaymentProvider.chargeCount += 1;
    return {
      kind: PROVIDER_RESULT.UNKNOWN,
      providerPaymentId: `pay_${input.operationId}`,
      failureCode: null,
    };
  }

  async getStatus(_providerRequestKey: string): Promise<ChargeResult> {
    return {
      kind: PROVIDER_RESULT.UNKNOWN,
      providerPaymentId: null,
      failureCode: null,
    };
  }
}
