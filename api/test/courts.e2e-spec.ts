import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { Facility } from '../src/entities/facility.entity.js';
import { Court } from '../src/entities/court.entity.js';
import { Camera } from '../src/entities/camera.entity.js';

describe('CourtsController (e2e)', () => {
  let app: INestApplication<App>;
  let facilities: Repository<Facility>;
  let courts: Repository<Court>;
  let cameras: Repository<Camera>;
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
    cameras = moduleFixture.get(getRepositoryToken(Camera));

    const existingCourt = await courts.findOne({
      where: { slug: 'e2e-courts-test' },
    });
    if (existingCourt) {
      await cameras.delete({ courtId: existingCourt.id });
      await courts.delete({ id: existingCourt.id });
    }
    await facilities.delete({ slug: 'e2e-courts-facility' });

    facility = await facilities.save(
      facilities.create({
        name: 'E2E Courts Facility',
        slug: 'e2e-courts-facility',
      }),
    );
    court = await courts.save(
      courts.create({
        facilityId: facility.id,
        name: 'E2E Court',
        slug: 'e2e-courts-test',
      }),
    );
    await cameras.save(
      cameras.create({
        courtId: court.id,
        rtspUrl: 'rtsp://example.invalid/stream',
        onvifUrl: 'http://example.invalid/onvif',
        make: 'Reolink',
        model: 'Test',
      }),
    );
  });

  afterAll(async () => {
    await cameras.delete({ courtId: court.id });
    await courts.delete({ id: court.id });
    await facilities.delete({ id: facility.id });
    await app.close();
  });

  it('GET /v1/courts returns a lightweight list without a slug filter', async () => {
    const res = await request(app.getHttpServer()).get('/v1/courts').expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    const found = res.body.find(
      (item: { slug: string }) => item.slug === 'e2e-courts-test',
    );
    expect(found).toEqual({ id: court.id, name: 'E2E Court', slug: 'e2e-courts-test' });
  });

  it('GET /v1/courts?slug=... returns the court with camera details', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/courts')
      .query({ slug: 'e2e-courts-test' })
      .expect(200);
    expect(res.body).toEqual([
      {
        id: court.id,
        name: 'E2E Court',
        slug: 'e2e-courts-test',
        facilityId: facility.id,
        camera: {
          id: expect.any(String),
          rtspUrl: 'rtsp://example.invalid/stream',
          onvifUrl: 'http://example.invalid/onvif',
          make: 'Reolink',
          model: 'Test',
        },
      },
    ]);
  });

  it('GET /v1/courts/:id returns full court details with camera', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/courts/${court.id}`)
      .expect(200);
    expect(res.body.slug).toBe('e2e-courts-test');
    expect(res.body.facilityId).toBe(facility.id);
    expect(res.body.camera.make).toBe('Reolink');
  });

  it('GET /v1/courts/:id 404s for an unknown id', async () => {
    await request(app.getHttpServer()).get('/v1/courts/999999999').expect(404);
  });
});
