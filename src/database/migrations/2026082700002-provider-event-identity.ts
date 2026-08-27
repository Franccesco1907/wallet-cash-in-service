import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ProviderEventIdentity2026082700002 implements MigrationInterface {
  name = 'ProviderEventIdentity2026082700002';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE provider_events
       ADD COLUMN provider_payment_id varchar(128) NOT NULL DEFAULT 'legacy_unknown'`,
    );
    await queryRunner.query(
      `ALTER TABLE provider_events
       ALTER COLUMN provider_payment_id DROP DEFAULT`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE provider_events DROP COLUMN provider_payment_id',
    );
  }
}
