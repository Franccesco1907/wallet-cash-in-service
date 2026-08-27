import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import {
  PAYMENT_EVENT_TYPE,
  type PaymentEventType,
} from '../../application/cash-in.service.js';

export class PaymentWebhookDto {
  @IsString()
  event_id!: string;

  @IsUUID()
  operation_id!: string;

  @IsIn(Object.values(PAYMENT_EVENT_TYPE))
  type!: PaymentEventType;

  @IsInt()
  @Min(1)
  sequence!: number;

  @IsString()
  provider_payment_id!: string;

  @IsOptional()
  @IsString()
  failure_code?: string;
}
