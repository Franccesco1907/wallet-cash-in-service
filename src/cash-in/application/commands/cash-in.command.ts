export interface CashInCommand {
  idempotencyKey: string;
  userId: string;
  amount: string;
  currency: string;
  paymentMethod: string;
}
