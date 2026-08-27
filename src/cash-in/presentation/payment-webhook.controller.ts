import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  type RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { CashInService } from '../application/cash-in.service.js';
import { WebhookSignatureVerifier } from '../infrastructure/payment/webhook-signature-verifier.js';
import { PaymentWebhookDto } from './dto/payment-webhook.dto.js';

@Controller('webhooks/payment')
export class PaymentWebhookController {
  constructor(
    private readonly service: CashInService,
    private readonly signatures: WebhookSignatureVerifier,
  ) {}

  @Post()
  @HttpCode(202)
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-webhook-signature') signature: string | undefined,
    @Body() body: PaymentWebhookDto,
  ): Promise<{ accepted: true }> {
    const rawBody = request.rawBody;
    if (!rawBody || !signature || !this.signatures.verify(rawBody, signature)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
    await this.service.handleSuccessfulWebhook({
      eventId: body.event_id,
      operationId: body.operation_id,
      eventType: body.type,
      sequence: BigInt(body.sequence),
      providerPaymentId: body.provider_payment_id,
      payloadHash: createHash('sha256').update(rawBody).digest('hex'),
    });
    return { accepted: true };
  }
}
