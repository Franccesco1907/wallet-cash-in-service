import { IsIn, IsInt, IsString, IsUUID, Min } from 'class-validator';

export class PaymentWebhookDto {
  @IsString()
  event_id!: string;

  @IsUUID()
  operation_id!: string;

  @IsIn(['payment.succeeded'])
  type!: string;

  @IsInt()
  @Min(1)
  sequence!: number;

  @IsString()
  provider_payment_id!: string;
}
