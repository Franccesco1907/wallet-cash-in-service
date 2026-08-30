import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  registerDecorator,
  type ValidationOptions,
} from 'class-validator';
import {
  PAYMENT_EVENT_TYPE,
  type PaymentEventType,
} from '../../application/commands/payment-webhook.command.ts';

const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;

function normalizeSequence(value: unknown): unknown {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return value.toString();
  }
  return value;
}

function IsPostgresBigint(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isPostgresBigint',
      target: target.constructor,
      propertyName: propertyName.toString(),
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return (
            typeof value === 'string' &&
            /^[1-9]\d*$/.test(value) &&
            value.length <= 19 &&
            BigInt(value) <= POSTGRES_BIGINT_MAX
          );
        },
      },
    });
  };
}

export class PaymentWebhookDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  event_id!: string;

  @IsUUID()
  operation_id!: string;

  @IsIn(Object.values(PAYMENT_EVENT_TYPE))
  type!: PaymentEventType;

  @Transform(({ value }: { value: unknown }) => normalizeSequence(value))
  @IsString()
  @IsPostgresBigint({
    message: 'sequence must be a positive PostgreSQL BIGINT decimal string',
  })
  sequence!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  provider_payment_id!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  failure_code?: string | null;
}
