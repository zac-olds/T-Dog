import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { RecorderAuthGuard } from '../common/guards/recorder-auth.guard.js';
import { RecordersService } from './recorders.service.js';
import { RecorderWebhookDto } from './dto/recorder-webhook.dto.js';

// Rails renders these with a plain `render json:` (no explicit status),
// which defaults to 200 — not Nest's default 201 for @Post().
@Controller('recorders')
@UseGuards(RecorderAuthGuard)
export class RecordersController {
  constructor(private readonly recordersService: RecordersService) {}

  @Post('heartbeat')
  @HttpCode(200)
  heartbeat() {
    return this.recordersService.heartbeat();
  }

  @Post('webhook')
  @HttpCode(200)
  webhook(@Body() dto: RecorderWebhookDto) {
    return this.recordersService.webhook(dto);
  }
}
