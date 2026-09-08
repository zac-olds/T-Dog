import { Module } from '@nestjs/common';
import { S3PresignerService } from './s3-presigner.service.js';

@Module({
  providers: [S3PresignerService],
  exports: [S3PresignerService],
})
export class S3Module {}
