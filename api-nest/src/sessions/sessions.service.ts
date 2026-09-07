import { randomBytes } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Repository } from 'typeorm';
import { Queue } from 'bullmq';
import { Session } from '../entities/session.entity.js';
import { Court } from '../entities/court.entity.js';
import { S3PresignerService } from '../common/s3/s3-presigner.service.js';
import {
  CLIP_REQUEST_QUEUE,
  ClipRequestJobData,
} from '../jobs/clip-request/clip-request.constants.js';
import { CreateSessionDto } from './dto/create-session.dto.js';

@Injectable()
export class SessionsService {
  constructor(
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    @InjectRepository(Court) private readonly courts: Repository<Court>,
    private readonly s3Presigner: S3PresignerService,
    @InjectQueue(CLIP_REQUEST_QUEUE)
    private readonly clipRequestQueue: Queue<ClipRequestJobData>,
  ) {}

  async create(dto: CreateSessionDto) {
    const court = await this.courts.findOne({
      where: { id: String(dto.courtId) },
    });
    if (!court) {
      throw new NotFoundException(`Court ${dto.courtId} not found`);
    }

    const session = await this.sessions.save(
      this.sessions.create({
        courtId: court.id,
        userContact: dto.userContact ?? null,
        status: 'active',
        startedAt: new Date(),
        token: randomBytes(18).toString('base64url'),
      }),
    );

    return {
      id: session.id,
      token: session.token,
      status: session.status,
      startedAt: session.startedAt,
    };
  }

  async findOne(id: number) {
    const session = await this.findOrThrow(id);
    return this.serialize(session);
  }

  async stop(id: number) {
    const session = await this.findOrThrow(id);
    session.endedAt = new Date();
    session.status = 'processing';
    await this.sessions.save(session);
    await this.clipRequestQueue.add(
      'request-clip',
      { sessionId: session.id },
      { removeOnComplete: true, removeOnFail: 50 },
    );
    return { id: session.id, status: session.status, ok: true };
  }

  async presignedDownload(id: number) {
    const session = await this.findOrThrow(id);
    if (!session.s3Key) {
      return null;
    }
    const url = await this.s3Presigner.presignDownload(session.s3Key);
    return { url };
  }

  private async findOrThrow(id: number): Promise<Session> {
    const session = await this.sessions.findOne({ where: { id: String(id) } });
    if (!session) {
      throw new NotFoundException(`Session ${id} not found`);
    }
    return session;
  }

  private serialize(session: Session) {
    return {
      id: session.id,
      courtId: session.courtId,
      userContact: session.userContact,
      status: session.status,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      durationS: session.durationS,
      s3Key: session.s3Key,
      token: session.token,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }
}
