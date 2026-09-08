import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Session } from '../../entities/session.entity.js';

/**
 * Outbound wire format matches the external recorder service's contract
 * (snake_case), not this app's own camelCase convention — we don't control
 * that service, so this has to stay compatible with it as-is.
 */
export interface ClipRequestBody {
  session_id: string;
  court_id: string;
  started_at: string | null;
  ended_at: string | null;
  rtsp_url: string | null;
  s3_bucket: string | undefined;
  s3_key_prefix: string;
  callback_url: string;
}

@Injectable()
export class RecorderClientService {
  constructor(
    private readonly config: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  async requestClip(session: Session): Promise<Response> {
    const url = `${this.baseUrl()}/api/clip`;
    const body: ClipRequestBody = {
      session_id: session.id,
      court_id: session.courtId,
      started_at: session.startedAt ? session.startedAt.toISOString() : null,
      ended_at: session.endedAt ? session.endedAt.toISOString() : null,
      rtsp_url: session.court?.camera?.rtspUrl ?? null,
      s3_bucket: this.config.get<string>('S3_BUCKET'),
      s3_key_prefix: `sessions/${session.id}`,
      callback_url: `${this.config.get<string>('APP_BASE_URL')}/v1/recorders/webhook`,
    };

    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.issueJwt()}`,
      },
      body: JSON.stringify(body),
    });
  }

  private baseUrl(): string {
    return this.config.get<string>('RECORDER_URL') ?? 'http://localhost:4000';
  }

  private issueJwt(): string {
    return this.jwtService.sign({ role: 'rails', svc: 'api' });
  }
}
