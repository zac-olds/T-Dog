import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { Facility } from '../src/entities/facility.entity.js';
import { Court } from '../src/entities/court.entity.js';
import { Session } from '../src/entities/session.entity.js';

// Checkout session creation is a real Stripe API call — mock the SDK so
// this test exercises everything except the actual network request.
const { checkoutSessionsCreate } = vi.hoisted(() => ({
  checkoutSessionsCreate: vi.fn(),
}));

vi.mock('stripe', () => ({
  // Must be a real `function`, not an arrow function — arrow functions
  // aren't constructable, and this stands in for `new Stripe(...)`.
  default: vi.fn().mockImplementation(function StripeMock() {
    return {
      checkout: { sessions: { create: checkoutSessionsCreate } },
      webhooks: { constructEvent: vi.fn() },
    };
  }),
}));

describe('PaymentsController (e2e)', () => {
  let app: INestApplication<App>;
  let facilities: Repository<Facility>;
  let courts: Repository<Court>;
  let sessions: Repository<Session>;
  let facility: Facility;
  let court: Court;
  let session: Session;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = configureApp(moduleFixture.createNestApplication());
    await app.init();

    facilities = moduleFixture.get(getRepositoryToken(Facility));
    courts = moduleFixture.get(getRepositoryToken(Court));
    sessions = moduleFixture.get(getRepositoryToken(Session));

    const existingCourt = await courts.findOne({
      where: { slug: 'e2e-payments-court' },
    });
    if (existingCourt) {
      await sessions.delete({ courtId: existingCourt.id });
      await courts.delete({ id: existingCourt.id });
    }
    await facilities.delete({ slug: 'e2e-payments-facility' });

    facility = await facilities.save(
      facilities.create({
        name: 'E2E Payments Facility',
        slug: 'e2e-payments-facility',
      }),
    );
    court = await courts.save(
      courts.create({
        facilityId: facility.id,
        name: 'E2E Court',
        slug: 'e2e-payments-court',
      }),
    );
    session = await sessions.save(
      sessions.create({
        courtId: court.id,
        userContact: 'payer@example.com',
        status: 'delivered',
        token: 'e2e-payments-token',
      }),
    );
  });

  afterAll(async () => {
    await sessions.delete({ courtId: court.id });
    await courts.delete({ id: court.id });
    await facilities.delete({ id: facility.id });
    await app.close();
  });

  beforeEach(() => {
    checkoutSessionsCreate.mockReset();
    checkoutSessionsCreate.mockResolvedValue({
      url: 'https://checkout.stripe.com/fake-session',
    });
  });

  it('POST /v1/payments/checkout creates a Stripe session linked to the recording session', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/payments/checkout')
      .send({ sessionId: Number(session.id) })
      .expect(200);

    expect(res.body).toEqual({ url: 'https://checkout.stripe.com/fake-session' });
    expect(checkoutSessionsCreate).toHaveBeenCalledTimes(1);

    const args = checkoutSessionsCreate.mock.calls[0][0];
    expect(args.mode).toBe('payment');
    expect(args.metadata).toEqual({
      session_id: session.id,
      user_contact: 'payer@example.com',
    });
    expect(args.success_url).toContain('{CHECKOUT_SESSION_ID}');
  });

  it('POST /v1/payments/checkout 404s for an unknown session', async () => {
    await request(app.getHttpServer())
      .post('/v1/payments/checkout')
      .send({ sessionId: 999999999 })
      .expect(404);
    expect(checkoutSessionsCreate).not.toHaveBeenCalled();
  });
});
