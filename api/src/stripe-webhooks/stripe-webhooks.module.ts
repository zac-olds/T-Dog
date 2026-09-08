import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Session } from '../entities/session.entity.js';
import { StripeWebhooksController } from './stripe-webhooks.controller.js';
import { StripeWebhooksService } from './stripe-webhooks.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Session])],
  controllers: [StripeWebhooksController],
  providers: [StripeWebhooksService],
})
export class StripeWebhooksModule {}
