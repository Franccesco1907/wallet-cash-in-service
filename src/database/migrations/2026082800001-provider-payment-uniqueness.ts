import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ProviderPaymentUniqueness2026082800001 implements MigrationInterface {
  name = 'ProviderPaymentUniqueness2026082800001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_cash_in_operations_provider_payment_id"
       ON cash_in_operations (provider_payment_id)
       WHERE provider_payment_id IS NOT NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX "UQ_cash_in_operations_provider_payment_id"',
    );
  }
}
