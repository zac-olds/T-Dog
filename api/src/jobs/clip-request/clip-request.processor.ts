import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import { Session } from '../../entities/session.entity.js';
import { RecorderClientService } from '../../common/recorder-client/recorder-client.service.js';
import { CLIP_REQUEST_QUEUE, ClipRequestJobData } from './clip-request.constants.js';

@Processor(CLIP_REQUEST_QUEUE)
export class ClipRequestProcessor extends WorkerHost {
  private readonly logger = new Logger(ClipRequestProcessor.name);

  constructor(
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    private readonly recorderClient: RecorderClientService,
  ) {
    super();
  }

  async process(job: Job<ClipRequestJobData>): Promise<void> {
    const session = await this.sessions.findOne({
      where: { id: job.data.sessionId },
      relations: { court: { camera: true } },
    });
    if (!session) {
      this.logger.warn(
        `Session ${job.data.sessionId} not found, skipping clip request`,
      );
      return;
    }
    await this.recorderClient.requestClip(session);
  }
}
