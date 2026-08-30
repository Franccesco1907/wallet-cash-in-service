export interface CashInResponse {
  operation_id: string;
  status: string;
  amount: number | string;
  new_balance?: number | string;
  error_code?: string;
}

export interface CashInExecution {
  httpStatus: number;
  response: CashInResponse;
}
