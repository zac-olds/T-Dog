import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Session } from '../entities/session.entity.js';
import { RecordersController } from './recorders.controller.js';
import { RecordersService } from './recorders.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Session])],
  controllers: [RecordersController],
  providers: [RecordersService],
})
export class RecordersModule {}
