import type { OperationState } from '../../domain/operation-state.js';

export interface CreateOperationInput {
  operationId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  providerRequestKey: string;
  userId: string;
  amountMinor: bigint;
  currency: string;
  paymentMethod: string;
}

export interface CashInOperation extends CreateOperationInput {
  status: OperationState;
  providerPaymentId: string | null;
  failureCode: string | null;
  completedBalanceMinor: bigint | null;
}

export interface OperationClaim {
  operation: CashInOperation;
  authorized: boolean;
}

export interface CompletionResult {
  operation: CashInOperation;
  resultingBalanceMinor: bigint;
}

export const PROVIDER_EVENT_DECISION = {
  PROCESS: 'PROCESS',
  DUPLICATE: 'DUPLICATE',
  OLD: 'OLD',
} as const;

export type ProviderEventDecision =
  (typeof PROVIDER_EVENT_DECISION)[keyof typeof PROVIDER_EVENT_DECISION];

export interface ProviderEventInput {
  eventId: string;
  operationId: string;
  eventType: string;
  sequence: bigint;
  payloadHash: string;
}

export interface CashInStorePort {
  createOrGet(input: CreateOperationInput): Promise<OperationClaim>;
  markPaymentRequested(operationId: string): Promise<void>;
  getById(operationId: string): Promise<CashInOperation | null>;
  finalizeCompleted(
    operationId: string,
    providerPaymentId: string,
  ): Promise<CompletionResult>;
  markFailed(operationId: string, failureCode: string): Promise<void>;
  markAwaitingConfirmation(operationId: string): Promise<void>;
  recordProviderEvent(
    input: ProviderEventInput,
  ): Promise<ProviderEventDecision>;
  markProviderEventProcessed(eventId: string): Promise<void>;
}

export const CASH_IN_STORE = Symbol('CASH_IN_STORE');
