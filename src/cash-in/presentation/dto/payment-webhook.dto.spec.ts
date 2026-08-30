import { validateSync } from 'class-validator';
import { PaymentWebhookDto } from './payment-webhook.dto.js';

function validWebhook(): PaymentWebhookDto {
  return Object.assign(new PaymentWebhookDto(), {
    event_id: 'e'.repeat(128),
    operation_id: '9c201f83-79b1-4a25-b922-942a581a55e4',
    type: 'payment.failed',
    sequence: '1',
    provider_payment_id: 'p'.repeat(128),
    failure_code: 'f'.repeat(64),
  });
}

function errorsFor(property: keyof PaymentWebhookDto, value: string): string[] {
  const dto = validWebhook();
  Object.assign(dto, { [property]: value });
  return validateSync(dto)
    .filter((error) => error.property === property)
    .flatMap((error) => Object.keys(error.constraints ?? {}));
}

describe('PaymentWebhookDto', () => {
  it('accepts values at the PostgreSQL column limits', () => {
    expect(validateSync(validWebhook())).toEqual([]);
  });

  it.each([
    ['event_id', '', 'isNotEmpty'],
    ['event_id', 'e'.repeat(129), 'maxLength'],
    ['provider_payment_id', '', 'isNotEmpty'],
    ['provider_payment_id', 'p'.repeat(129), 'maxLength'],
    ['failure_code', '', 'isNotEmpty'],
    ['failure_code', 'f'.repeat(65), 'maxLength'],
  ] as const)('rejects invalid %s values', (property, value, constraint) => {
    expect(errorsFor(property, value)).toContain(constraint);
  });

  it('accepts an omitted or null failure code', () => {
    const omitted = validWebhook();
    delete omitted.failure_code;
    const nullable = validWebhook();
    nullable.failure_code = null;

    expect(validateSync(omitted)).toEqual([]);
    expect(validateSync(nullable)).toEqual([]);
  });
});
