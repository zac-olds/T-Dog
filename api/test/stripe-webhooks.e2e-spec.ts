import { createHmac } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { Facility } from '../src/entities/facility.entity.js';
import { Court } from '../src/entities/court.entity.js';
import { Session } from '../src/entities/session.entity.js';

function stripeSignatureHeader(
  payload: string,
  secret: string,
  timestamp = Math.floor(Date.now() / 1000),
): string {
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

describe('StripeWebhooksController (e2e)', () => {
  let app: INestApplication<App>;
  let facilities: Repository<Facility>;
  let courts: Repository<Court>;
  let sessions: Repository<Session>;
  let facility: Facility;
  let court: Court;
  let session: Session;
  let webhookSecret: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = configureApp(
      moduleFixture.createNestApplication<NestExpressApplication>({
        rawBody: true,
      }),
    );
    await app.init();

    // Read via ConfigService (populated by ConfigModule.forRoot() during
    // compile() above), not process.env directly — process.env isn't
    // guaranteed to have .env's values loaded yet at describe-block
    // collection time, before beforeAll runs.
    webhookSecret =
      moduleFixture.get(ConfigService).get<string>('STRIPE_WEBHOOK_SECRET') ??
      '';

    facilities = moduleFixture.get(getRepositoryToken(Facility));
    courts = moduleFixture.get(getRepositoryToken(Court));
    sessions = moduleFixture.get(getRepositoryToken(Session));

    const existingCourt = await courts.findOne({
      where: { slug: 'e2e-stripe-webhooks-court' },
    });
    if (existingCourt) {
      await sessions.delete({ courtId: existingCourt.id });
      await courts.delete({ id: existingCourt.id });
    }
    await facilities.delete({ slug: 'e2e-stripe-webhooks-facility' });

    facility = await facilities.save(
      facilities.create({
        name: 'E2E Stripe Webhooks Facility',
        slug: 'e2e-stripe-webhooks-facility',
      }),
    );
    court = await courts.save(
      courts.create({
        facilityId: facility.id,
        name: 'E2E Court',
        slug: 'e2e-stripe-webhooks-court',
      }),
    );
  });

  beforeEach(async () => {
    session = await sessions.save(
      sessions.create({
        courtId: court.id,
        status: 'delivered',
        token: `e2e-stripe-webhooks-token-${Date.now()}-${Math.random()}`,
        paid: false,
      }),
    );
  });

  afterAll(async () => {
    await sessions.delete({ courtId: court.id });
    await courts.delete({ id: court.id });
    await facilities.delete({ id: facility.id });
    await app.close();
  });

  function checkoutCompletedPayload(sessionId?: string) {
    return JSON.stringify({
      id: 'evt_test_123',
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_123',
          object: 'checkout.session',
          metadata: sessionId ? { session_id: sessionId } : {},
        },
      },
    });
  }

  it('marks the session paid on a valid checkout.session.completed webhook', async () => {
    const payload = checkoutCompletedPayload(session.id);
    const signature = stripeSignatureHeader(payload, webhookSecret);

    await request(app.getHttpServer())
      .post('/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', signature)
      .send(payload)
      .expect(200);

    const updated = await sessions.findOneOrFail({ where: { id: session.id } });
    expect(updated.paid).toBe(true);
  });

  it('rejects an invalid signature with 400', async () => {
    const payload = checkoutCompletedPayload(session.id);

    await request(app.getHttpServer())
      .post('/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', 't=1,v1=not-a-real-signature')
      .send(payload)
      .expect(400);

    const unchanged = await sessions.findOneOrFail({ where: { id: session.id } });
    expect(unchanged.paid).toBe(false);
  });

  it('rejects a missing signature header with 400', async () => {
    const payload = checkoutCompletedPayload(session.id);

    await request(app.getHttpServer())
      .post('/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send(payload)
      .expect(400);
  });

  it('accepts other event types as a no-op, matching Rails’ case statement', async () => {
    const payload = JSON.stringify({
      id: 'evt_test_456',
      object: 'event',
      type: 'payment_intent.created',
      data: { object: { id: 'pi_test_456' } },
    });
    const signature = stripeSignatureHeader(payload, webhookSecret);

    await request(app.getHttpServer())
      .post('/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', signature)
      .send(payload)
      .expect(200);

    const unchanged = await sessions.findOneOrFail({ where: { id: session.id } });
    expect(unchanged.paid).toBe(false);
  });

  it('is a no-op (still 200) when checkout.session.completed has no session_id metadata', async () => {
    const payload = checkoutCompletedPayload(undefined);
    const signature = stripeSignatureHeader(payload, webhookSecret);

    await request(app.getHttpServer())
      .post('/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', signature)
      .send(payload)
      .expect(200);
  });
});
