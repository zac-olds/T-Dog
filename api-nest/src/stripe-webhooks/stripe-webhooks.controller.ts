import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import { StripeWebhooksService } from './stripe-webhooks.service.js';

@Controller('webhooks')
export class StripeWebhooksController {
  constructor(private readonly stripeWebhooksService: StripeWebhooksService) {}

  // Rails does `head :ok` (200, empty body) on success — matched via
  // @HttpCode(200) and returning nothing.
  @Post('stripe')
  @HttpCode(200)
  async handle(@Req() req: RawBodyRequest<Request>): Promise<void> {
    await this.stripeWebhooksService.handle(
      req.rawBody,
      req.headers['stripe-signature'] as string | undefined,
    );
  }
}
