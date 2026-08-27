export const PROVIDER_RESULT = {
  SUCCESS: 'SUCCESS',
  REJECTED: 'REJECTED',
  UNKNOWN: 'UNKNOWN',
} as const;

export type ProviderResultKind =
  (typeof PROVIDER_RESULT)[keyof typeof PROVIDER_RESULT];

export interface ChargeInput {
  operationId: string;
  providerRequestKey: string;
  amountMinor: bigint;
  currency: string;
  paymentMethod: string;
  correlationId: string;
}

export interface ChargeResult {
  kind: ProviderResultKind;
  providerPaymentId: string | null;
  failureCode: string | null;
}

export interface PaymentProviderPort {
  charge(input: ChargeInput): Promise<ChargeResult>;
  getStatus(providerRequestKey: string): Promise<ChargeResult>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
