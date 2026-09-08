import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Stripe from 'stripe';
import { Session } from '../entities/session.entity.js';

@Injectable()
export class StripeWebhooksService {
  private readonly stripe: Stripe;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
  ) {
    this.stripe = new Stripe(this.config.get<string>('STRIPE_SECRET_KEY') ?? '');
  }

  async handle(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<void> {
    let event: Stripe.Event;
    try {
      if (!rawBody || !signature) {
        throw new Error('missing body or signature');
      }
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.config.get<string>('STRIPE_WEBHOOK_SECRET') ?? '',
      );
    } catch {
      throw new BadRequestException();
    }

    if (event.type === 'checkout.session.completed') {
      const checkoutSession = event.data.object;
      const sessionId = checkoutSession.metadata?.session_id;
      if (sessionId) {
        await this.sessions.update({ id: sessionId }, { paid: true });
      }
    }
    // Other event types are accepted but currently no-ops, matching
    // Rails' `case` statement (it only handles checkout.session.completed).
  }
}
