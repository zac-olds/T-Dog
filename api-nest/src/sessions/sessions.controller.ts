import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { SessionsService } from './sessions.service.js';
import { CreateSessionDto } from './dto/create-session.dto.js';

@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  // Rails renders these with a plain `render json:` (no explicit status),
  // which defaults to 200 — not Nest's default 201 for @Post().
  @Post()
  @HttpCode(200)
  create(@Body() dto: CreateSessionDto) {
    return this.sessionsService.create(dto);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.sessionsService.findOne(id);
  }

  @Post(':id/stop')
  @HttpCode(200)
  stop(@Param('id', ParseIntPipe) id: number) {
    return this.sessionsService.stop(id);
  }

  @Get(':id/presigned_download')
  async presignedDownload(@Param('id', ParseIntPipe) id: number) {
    const result = await this.sessionsService.presignedDownload(id);
    if (!result) {
      throw new NotFoundException();
    }
    return result;
  }
}
