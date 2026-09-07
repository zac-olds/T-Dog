import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Session } from '../entities/session.entity.js';
import { Court } from '../entities/court.entity.js';
import { S3Module } from '../common/s3/s3.module.js';
import { SessionsController } from './sessions.controller.js';
import { SessionsService } from './sessions.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Session, Court]), S3Module],
  controllers: [SessionsController],
  providers: [SessionsService],
})
export class SessionsModule {}
