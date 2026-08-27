import { Transform } from 'class-transformer';
import { IsIn, IsString, Matches, MaxLength } from 'class-validator';

export class CreateCashInDto {
  @IsString()
  @MaxLength(128)
  user_id!: string;

  @IsString()
  @Matches(/^(?:0\.(?:0[1-9]|[1-9]\d?)|[1-9]\d*(?:\.\d{1,2})?)$/)
  amount!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsIn(['PEN'])
  currency!: string;

  @IsString()
  @MaxLength(256)
  payment_method!: string;
}
