import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
} from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { validateSync } from 'class-validator';
import {
  CashInService,
  type CashInResponse,
} from '../application/cash-in.service.js';
import { CreateCashInDto } from './dto/create-cash-in.dto.js';

class IdempotencyHeader {
  @IsUUID()
  value!: string;
}

@Controller('cash-in')
export class CashInController {
  constructor(private readonly service: CashInService) {}

  @Post()
  @HttpCode(202)
  async create(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CreateCashInDto,
  ): Promise<CashInResponse> {
    const header = Object.assign(new IdempotencyHeader(), {
      value: idempotencyKey,
    });
    if (validateSync(header).length > 0) {
      throw new BadRequestException('Idempotency-Key must be a UUID');
    }
    return this.service.execute({
      idempotencyKey: header.value,
      userId: body.user_id,
      amount: String(body.amount),
      currency: body.currency,
      paymentMethod: body.payment_method,
    });
  }
}
