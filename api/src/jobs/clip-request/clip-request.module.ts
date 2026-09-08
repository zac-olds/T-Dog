import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Session } from '../../entities/session.entity.js';
import { RecorderClientModule } from '../../common/recorder-client/recorder-client.module.js';
import { ClipRequestProcessor } from './clip-request.processor.js';
import { CLIP_REQUEST_QUEUE } from './clip-request.constants.js';

@Module({
  imports: [
    BullModule.registerQueue({ name: CLIP_REQUEST_QUEUE }),
    TypeOrmModule.forFeature([Session]),
    RecorderClientModule,
  ],
  providers: [ClipRequestProcessor],
  exports: [BullModule],
})
export class ClipRequestModule {}
