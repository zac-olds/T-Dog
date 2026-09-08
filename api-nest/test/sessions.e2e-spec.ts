import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { Repository } from 'typeorm';
import { Queue } from 'bullmq';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { Facility } from '../src/entities/facility.entity.js';
import { Court } from '../src/entities/court.entity.js';
import { Session } from '../src/entities/session.entity.js';
import { CLIP_REQUEST_QUEUE } from '../src/jobs/clip-request/clip-request.constants.js';

describe('SessionsController (e2e)', () => {
  let app: INestApplication<App>;
  let facilities: Repository<Facility>;
  let courts: Repository<Court>;
  let sessions: Repository<Session>;
  let clipRequestQueue: Queue;
  let facility: Facility;
  let court: Court;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = configureApp(moduleFixture.createNestApplication());
    await app.init();

    facilities = moduleFixture.get(getRepositoryToken(Facility));
    courts = moduleFixture.get(getRepositoryToken(Court));
    sessions = moduleFixture.get(getRepositoryToken(Session));
    clipRequestQueue = moduleFixture.get(getQueueToken(CLIP_REQUEST_QUEUE));

    const existingCourt = await courts.findOne({
      where: { slug: 'e2e-sessions-court' },
    });
    if (existingCourt) {
      await sessions.delete({ courtId: existingCourt.id });
      await courts.delete({ id: existingCourt.id });
    }
    await facilities.delete({ slug: 'e2e-sessions-facility' });

    facility = await facilities.save(
      facilities.create({
        name: 'E2E Sessions Facility',
        slug: 'e2e-sessions-facility',
      }),
    );
    court = await courts.save(
      courts.create({
        facilityId: facility.id,
        name: 'E2E Court',
        slug: 'e2e-sessions-court',
      }),
    );
  });

  afterAll(async () => {
    await sessions.delete({ courtId: court.id });
    await courts.delete({ id: court.id });
    await facilities.delete({ id: facility.id });
    await app.close();
  });

  it('POST /v1/sessions creates an active session and returns 200', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/sessions')
      .send({ courtId: Number(court.id), userContact: '555-0100' })
      .expect(200);

    expect(res.body).toMatchObject({ status: 'active' });
    expect(res.body.id).toBeDefined();
    expect(res.body.token).toBeTruthy();
    expect(res.body.startedAt).toBeDefined();
    // Partial view, same as Rails: no courtId/userContact/etc. here.
    expect(res.body.courtId).toBeUndefined();
  });

  it('POST /v1/sessions 404s for an unknown court', async () => {
    await request(app.getHttpServer())
      .post('/v1/sessions')
      .send({ courtId: 999999999 })
      .expect(404);
  });

  it('full lifecycle: create -> show -> stop -> presigned_download', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/sessions')
      .send({ courtId: Number(court.id), userContact: '555-0101' })
      .expect(200);

    const id = created.body.id;

    const shown = await request(app.getHttpServer())
      .get(`/v1/sessions/${id}`)
      .expect(200);
    expect(shown.body).toMatchObject({
      id,
      courtId: court.id,
      userContact: '555-0101',
      status: 'active',
    });

    // No s3Key yet -> 404, matching Rails' `head :not_found`.
    await request(app.getHttpServer())
      .get(`/v1/sessions/${id}/presigned_download`)
      .expect(404);

    const stopped = await request(app.getHttpServer())
      .post(`/v1/sessions/${id}/stop`)
      .expect(200);
    expect(stopped.body).toEqual({ id, status: 'processing', ok: true });

    // stop() now actually enqueues a clip request (Phase 2 left this as a
    // no-op on purpose; Phase 3 wires it up).
    const jobs = await clipRequestQueue.getJobs([
      'waiting',
      'active',
      'completed',
      'failed',
    ]);
    expect(jobs.some((job) => job.data.sessionId === id)).toBe(true);

    await sessions.update({ id }, { s3Key: `sessions/${id}/clip.mp4` });

    const presigned = await request(app.getHttpServer())
      .get(`/v1/sessions/${id}/presigned_download`)
      .expect(200);
    expect(typeof presigned.body.url).toBe('string');
    expect(presigned.body.url).toContain('clip.mp4');
    expect(presigned.body.url).toContain('X-Amz-Signature');
  });

  it('GET /v1/sessions/:id 404s for an unknown id', async () => {
    await request(app.getHttpServer())
      .get('/v1/sessions/999999999')
      .expect(404);
  });

  it('POST /v1/sessions/:id/stop 404s for an unknown id', async () => {
    await request(app.getHttpServer())
      .post('/v1/sessions/999999999/stop')
      .expect(404);
  });
});
