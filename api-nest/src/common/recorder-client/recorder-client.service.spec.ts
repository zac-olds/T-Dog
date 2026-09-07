import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecorderClientService } from './recorder-client.service.js';
import type { Session } from '../../entities/session.entity.js';

function buildSession(overrides: Partial<Session> = {}): Session {
  return {
    id: '42',
    courtId: '7',
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
    endedAt: new Date('2026-01-01T00:30:00.000Z'),
    court: {
      camera: { rtspUrl: 'rtsp://example.invalid/stream' },
    },
    ...overrides,
  } as Session;
}

describe('RecorderClientService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs the expected snake_case body and a signed recorder-role JWT', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const config = new ConfigService({
      RECORDER_URL: 'http://recorder.internal:4000',
      S3_BUCKET: 'test-bucket',
      APP_BASE_URL: 'https://api.example.com',
    });
    const jwtService = new JwtService({ secret: 'test-secret' });
    const service = new RecorderClientService(config, jwtService);

    await service.requestClip(buildSession());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://recorder.internal:4000/api/clip');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');

    const token = init.headers.Authorization.replace('Bearer ', '');
    const claims = jwtService.verify(token);
    expect(claims).toMatchObject({ role: 'rails', svc: 'api' });

    const body = JSON.parse(init.body);
    expect(body).toEqual({
      session_id: '42',
      court_id: '7',
      started_at: '2026-01-01T00:00:00.000Z',
      ended_at: '2026-01-01T00:30:00.000Z',
      rtsp_url: 'rtsp://example.invalid/stream',
      s3_bucket: 'test-bucket',
      s3_key_prefix: 'sessions/42',
      callback_url: 'https://api.example.com/v1/recorders/webhook',
    });
  });

  it('defaults RECORDER_URL to http://localhost:4000 when unset', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const service = new RecorderClientService(
      new ConfigService({}),
      new JwtService({ secret: 'test-secret' }),
    );

    await service.requestClip(buildSession());

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:4000/api/clip');
  });

  it('sends null rtsp_url when the court has no camera', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const service = new RecorderClientService(
      new ConfigService({}),
      new JwtService({ secret: 'test-secret' }),
    );

    await service.requestClip(buildSession({ court: {} as Session['court'] }));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.rtsp_url).toBeNull();
  });
});
