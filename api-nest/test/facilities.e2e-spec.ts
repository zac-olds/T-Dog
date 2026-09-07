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

describe('FacilitiesController (e2e)', () => {
  let app: INestApplication<App>;
  let facilities: Repository<Facility>;
  let courts: Repository<Court>;
  let facility: Facility;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = configureApp(moduleFixture.createNestApplication());
    await app.init();

    facilities = moduleFixture.get(getRepositoryToken(Facility));
    courts = moduleFixture.get(getRepositoryToken(Court));

    await courts.delete({ slug: 'e2e-facilities-court' });
    await facilities.delete({ slug: 'e2e-facilities-test' });

    facility = await facilities.save(
      facilities.create({
        name: 'E2E Test Facility',
        slug: 'e2e-facilities-test',
      }),
    );
    await courts.save(
      courts.create({
        facilityId: facility.id,
        name: 'E2E Court',
        slug: 'e2e-facilities-court',
      }),
    );
  });

  afterAll(async () => {
    await courts.delete({ slug: 'e2e-facilities-court' });
    await facilities.delete({ slug: 'e2e-facilities-test' });
    await app.close();
  });

  it('GET /v1/facilities returns a list', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/facilities')
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    const found = res.body.find(
      (item: { slug: string }) => item.slug === 'e2e-facilities-test',
    );
    expect(found).toEqual({
      id: facility.id,
      name: 'E2E Test Facility',
      slug: 'e2e-facilities-test',
    });
  });

  it('GET /v1/facilities/:id returns the facility with its courts', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/facilities/${facility.id}`)
      .expect(200);
    expect(res.body.slug).toBe('e2e-facilities-test');
    expect(res.body.courts).toEqual([
      { id: expect.any(String), name: 'E2E Court', slug: 'e2e-facilities-court' },
    ]);
  });

  it('GET /v1/facilities/:id 404s for an unknown id', async () => {
    await request(app.getHttpServer())
      .get('/v1/facilities/999999999')
      .expect(404);
  });
});
