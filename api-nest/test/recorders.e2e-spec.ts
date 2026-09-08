import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { Facility } from '../src/entities/facility.entity.js';
import { Court } from '../src/entities/court.entity.js';
import { Session } from '../src/entities/session.entity.js';

describe('RecordersController (e2e)', () => {
  let app: INestApplication<App>;
  let jwtService: JwtService;
  let facilities: Repository<Facility>;
  let courts: Repository<Court>;
  let sessions: Repository<Session>;
  let facility: Facility;
  let court: Court;
  let session: Session;
  let recorderToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = configureApp(moduleFixture.createNestApplication());
    await app.init();

    jwtService = moduleFixture.get(JwtService);
    facilities = moduleFixture.get(getRepositoryToken(Facility));
    courts = moduleFixture.get(getRepositoryToken(Court));
    sessions = moduleFixture.get(getRepositoryToken(Session));

    recorderToken = jwtService.sign({ role: 'recorder' });

    const existingCourt = await courts.findOne({
      where: { slug: 'e2e-recorders-court' },
    });
    if (existingCourt) {
      await sessions.delete({ courtId: existingCourt.id });
      await courts.delete({ id: existingCourt.id });
    }
    await facilities.delete({ slug: 'e2e-recorders-facility' });

    facility = await facilities.save(
      facilities.create({
        name: 'E2E Recorders Facility',
        slug: 'e2e-recorders-facility',
      }),
    );
    court = await courts.save(
      courts.create({
        facilityId: facility.id,
        name: 'E2E Court',
        slug: 'e2e-recorders-court',
      }),
    );
    session = await sessions.save(
      sessions.create({
        courtId: court.id,
        status: 'processing',
        token: 'e2e-recorders-token',
      }),
    );
  });

  afterAll(async () => {
    await sessions.delete({ courtId: court.id });
    await courts.delete({ id: court.id });
    await facilities.delete({ id: facility.id });
    await app.close();
  });

  it('POST /v1/recorders/heartbeat requires a recorder token', async () => {
    await request(app.getHttpServer()).post('/v1/recorders/heartbeat').expect(401);
  });

  it('POST /v1/recorders/heartbeat rejects a token with the wrong role', async () => {
    const railsToken = jwtService.sign({ role: 'rails' });
    await request(app.getHttpServer())
      .post('/v1/recorders/heartbeat')
      .set('Authorization', `Bearer ${railsToken}`)
      .expect(401);
  });

  it('POST /v1/recorders/heartbeat succeeds with a valid recorder token', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/recorders/heartbeat')
      .set('Authorization', `Bearer ${recorderToken}`)
      .expect(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.time).toBe('string');
  });

  it('POST /v1/recorders/webhook requires a recorder token', async () => {
    await request(app.getHttpServer())
      .post('/v1/recorders/webhook')
      .send({ event: 'clip_uploaded', session_id: session.id })
      .expect(401);
  });

  it('POST /v1/recorders/webhook with clip_uploaded updates the session', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/recorders/webhook')
      .set('Authorization', `Bearer ${recorderToken}`)
      .send({
        event: 'clip_uploaded',
        session_id: session.id,
        s3_key: `sessions/${session.id}/clip.mp4`,
        duration_s: 120,
      })
      .expect(200);
    expect(res.body).toEqual({ ok: true });

    const updated = await sessions.findOneOrFail({ where: { id: session.id } });
    expect(updated.status).toBe('delivered');
    expect(updated.s3Key).toBe(`sessions/${session.id}/clip.mp4`);
    expect(updated.durationS).toBe(120);
  });

  it('POST /v1/recorders/webhook with clip_uploaded 404s for an unknown session', async () => {
    await request(app.getHttpServer())
      .post('/v1/recorders/webhook')
      .set('Authorization', `Bearer ${recorderToken}`)
      .send({ event: 'clip_uploaded', session_id: '999999999' })
      .expect(404);
  });

  it('POST /v1/recorders/webhook with an unrecognized event is a no-op that still returns ok', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/recorders/webhook')
      .set('Authorization', `Bearer ${recorderToken}`)
      .send({ event: 'started' })
      .expect(200);
    expect(res.body).toEqual({ ok: true });
  });
});
