import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
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
  async create(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CreateCashInDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CashInResponse> {
    const header = Object.assign(new IdempotencyHeader(), {
      value: idempotencyKey,
    });
    if (validateSync(header).length > 0) {
      throw new BadRequestException('Idempotency-Key must be a UUID');
    }
    const execution = await this.service.execute({
      idempotencyKey: header.value,
      userId: body.user_id,
      amount: String(body.amount),
      currency: body.currency,
      paymentMethod: body.payment_method,
    });
    response.status(execution.httpStatus);
    return execution.response;
  }
}
