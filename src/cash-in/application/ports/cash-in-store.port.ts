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

export interface CashInStorePort {
  createOrGet(input: CreateOperationInput): Promise<OperationClaim>;
  markPaymentRequested(operationId: string): Promise<void>;
  getById(operationId: string): Promise<CashInOperation | null>;
  finalizeCompleted(
    operationId: string,
    providerPaymentId: string,
  ): Promise<CompletionResult>;
}

export const CASH_IN_STORE = Symbol('CASH_IN_STORE');
