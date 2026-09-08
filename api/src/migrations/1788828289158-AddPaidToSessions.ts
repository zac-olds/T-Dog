import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Rails has no equivalent column or migration — nothing tracked payment
 * state for a session at all before this (see plans/nestjs-migration.md,
 * Phase 4). This is the first genuinely new schema this app owns outright.
 */
export class AddPaidToSessions1788828289158 implements MigrationInterface {
  name = 'AddPaidToSessions1788828289158';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sessions" ADD COLUMN "paid" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sessions" DROP COLUMN "paid"`);
  }
}
