import { Module } from '@nestjs/common';
import { RecorderClientService } from './recorder-client.service.js';

@Module({
  providers: [RecorderClientService],
  exports: [RecorderClientService],
})
export class RecorderClientModule {}
