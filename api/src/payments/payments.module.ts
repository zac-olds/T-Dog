import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Session } from '../entities/session.entity.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Session])],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
