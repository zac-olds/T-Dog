import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Stripe from 'stripe';
import { Session } from '../entities/session.entity.js';
import { CreateCheckoutDto } from './dto/create-checkout.dto.js';

@Injectable()
export class PaymentsService {
  private readonly stripe: Stripe;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
  ) {
    this.stripe = new Stripe(this.config.get<string>('STRIPE_SECRET_KEY') ?? '');
  }

  async checkout(dto: CreateCheckoutDto) {
    const session = await this.sessions.findOne({
      where: { id: String(dto.sessionId) },
    });
    if (!session) {
      throw new NotFoundException(`Session ${dto.sessionId} not found`);
    }

    const appBaseUrl = this.config.get<string>('APP_BASE_URL');
    const checkoutSession = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        { price: this.config.get<string>('STRIPE_PRICE_ID'), quantity: 1 },
      ],
      success_url: `${appBaseUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appBaseUrl}/payment/cancel`,
      metadata: {
        // session_id links the payment back to a recording session so the
        // Stripe webhook can mark it paid — Rails' checkout never did this
        // (no way to know which session a checkout was even for).
        session_id: session.id,
        user_contact: session.userContact ?? '',
      },
    });

    return { url: checkoutSession.url };
  }
}
