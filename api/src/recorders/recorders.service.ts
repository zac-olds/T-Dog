import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Session } from '../entities/session.entity.js';
import { RecorderWebhookDto } from './dto/recorder-webhook.dto.js';

@Injectable()
export class RecordersService {
  constructor(
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
  ) {}

  heartbeat() {
    return { ok: true, time: new Date().toISOString() };
  }

  async webhook(dto: RecorderWebhookDto) {
    if (dto.event === 'clip_uploaded') {
      const session = dto.session_id
        ? await this.sessions.findOne({ where: { id: dto.session_id } })
        : null;
      if (!session) {
        throw new NotFoundException(`Session ${dto.session_id} not found`);
      }
      session.s3Key = dto.s3_key ?? null;
      session.status = 'delivered';
      session.durationS = dto.duration_s ?? null;
      await this.sessions.save(session);
    }
    // Other event types (e.g. "started", "segment_uploaded") are accepted
    // but currently no-ops, matching Rails' case statement.
    return { ok: true };
  }
}
