export const PAYMENT_EVENT_TYPE = {
  SUCCEEDED: 'payment.succeeded',
  FAILED: 'payment.failed',
} as const;

export type PaymentEventType =
  (typeof PAYMENT_EVENT_TYPE)[keyof typeof PAYMENT_EVENT_TYPE];

export interface PaymentWebhookCommand {
  eventId: string;
  operationId: string;
  eventType: PaymentEventType;
  sequence: bigint;
  providerPaymentId: string;
  payloadHash: string;
  failureCode: string | null;
}
