import { Transform } from 'class-transformer';
import { IsIn, IsNumber, IsString, MaxLength, Min } from 'class-validator';

export class CreateCashInDto {
  @IsString()
  @MaxLength(128)
  user_id!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsIn(['PEN'])
  currency!: string;

  @IsString()
  @MaxLength(256)
  payment_method!: string;
}
