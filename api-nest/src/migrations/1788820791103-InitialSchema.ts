import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Recreates the schema T-Dog's Rails API already has in production
 * (facilities, courts, cameras, sessions) so the two apps are structurally
 * compatible. `courts.camera_id` is carried over even though it's unused —
 * see the comment on Court#cameraId.
 */
export class InitialSchema1788820791103 implements MigrationInterface {
  name = 'InitialSchema1788820791103';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "facilities" (
        "id" BIGSERIAL PRIMARY KEY,
        "name" varchar,
        "slug" varchar,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "index_facilities_on_slug" ON "facilities" ("slug")`,
    );

    await queryRunner.query(`
      CREATE TABLE "courts" (
        "id" BIGSERIAL PRIMARY KEY,
        "facility_id" bigint NOT NULL,
        "name" varchar,
        "slug" varchar,
        "camera_id" integer,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "fk_courts_facility" FOREIGN KEY ("facility_id") REFERENCES "facilities" ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "index_courts_on_facility_id" ON "courts" ("facility_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "index_courts_on_slug" ON "courts" ("slug")`,
    );

    await queryRunner.query(`
      CREATE TABLE "cameras" (
        "id" BIGSERIAL PRIMARY KEY,
        "court_id" bigint NOT NULL,
        "rtsp_url" varchar,
        "onvif_url" varchar,
        "make" varchar,
        "model" varchar,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "fk_cameras_court" FOREIGN KEY ("court_id") REFERENCES "courts" ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "index_cameras_on_court_id" ON "cameras" ("court_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "sessions" (
        "id" BIGSERIAL PRIMARY KEY,
        "court_id" bigint NOT NULL,
        "user_contact" varchar,
        "status" varchar,
        "started_at" TIMESTAMP,
        "ended_at" TIMESTAMP,
        "duration_s" integer,
        "s3_key" varchar,
        "token" varchar,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "fk_sessions_court" FOREIGN KEY ("court_id") REFERENCES "courts" ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "index_sessions_on_court_id" ON "sessions" ("court_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "index_sessions_on_token" ON "sessions" ("token")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "sessions"`);
    await queryRunner.query(`DROP TABLE "cameras"`);
    await queryRunner.query(`DROP TABLE "courts"`);
    await queryRunner.query(`DROP TABLE "facilities"`);
  }
}
