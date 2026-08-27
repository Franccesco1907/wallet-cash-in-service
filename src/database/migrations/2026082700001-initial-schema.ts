import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema2026082700001 implements MigrationInterface {
  name = 'InitialSchema2026082700001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE cash_in_operations (
        operation_id uuid PRIMARY KEY,
        idempotency_key uuid NOT NULL,
        request_fingerprint char(64) NOT NULL,
        provider_request_key uuid NOT NULL,
        user_id varchar(128) NOT NULL,
        amount_minor bigint NOT NULL CHECK (amount_minor > 0),
        currency char(3) NOT NULL,
        payment_method varchar(256) NOT NULL,
        status varchar(32) NOT NULL,
        provider_payment_id varchar(128),
        failure_code varchar(64),
        completed_balance_minor bigint,
        provider_event_sequence bigint NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_cash_in_operations_idempotency_key" UNIQUE (idempotency_key),
        CONSTRAINT "UQ_cash_in_operations_provider_request_key" UNIQUE (provider_request_key)
      )
    `);
    await queryRunner.query(`
      CREATE TABLE wallets (
        user_id varchar(128) NOT NULL,
        currency char(3) NOT NULL,
        balance_minor bigint NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, currency)
      )
    `);
    await queryRunner.query(`
      CREATE TABLE wallet_ledger (
        ledger_id uuid PRIMARY KEY,
        operation_id uuid NOT NULL REFERENCES cash_in_operations(operation_id),
        user_id varchar(128) NOT NULL,
        currency char(3) NOT NULL,
        amount_minor bigint NOT NULL,
        resulting_balance_minor bigint NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_wallet_ledger_operation_id" UNIQUE (operation_id)
      )
    `);
    await queryRunner.query(`
      CREATE TABLE provider_events (
        provider_event_id varchar(128) PRIMARY KEY,
        operation_id uuid NOT NULL REFERENCES cash_in_operations(operation_id),
        event_type varchar(64) NOT NULL,
        event_sequence bigint NOT NULL,
        payload_hash char(64) NOT NULL,
        processing_status varchar(32) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        processed_at timestamptz,
        CONSTRAINT "UQ_provider_events_provider_event_id" UNIQUE (provider_event_id)
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE provider_events');
    await queryRunner.query('DROP TABLE wallet_ledger');
    await queryRunner.query('DROP TABLE wallets');
    await queryRunner.query('DROP TABLE cash_in_operations');
  }
}
