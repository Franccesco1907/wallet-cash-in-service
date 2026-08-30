export interface OperationRow {
  operation_id: string;
  idempotency_key: string;
  request_fingerprint: string;
  provider_request_key: string;
  user_id: string;
  amount_minor: string;
  currency: string;
  payment_method: string;
  status: string;
  provider_payment_id: string | null;
  failure_code: string | null;
  completed_balance_minor: string | null;
}

export interface ProviderEventRow {
  operation_id: string;
  provider_payment_id: string;
  event_type: string;
  event_sequence: string;
  payload_hash: string;
  processing_status: string;
}
