import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { parseEnvironment } from '../../../config/environment.ts';

@Injectable()
export class WebhookSignatureVerifier {
  verify(rawBody: Buffer, signature: string): boolean {
    if (!/^[a-f0-9]{64}$/.test(signature)) return false;
    const expected = createHmac('sha256', parseEnvironment().WEBHOOK_SECRET)
      .update(rawBody)
      .digest();
    return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
  }
}
