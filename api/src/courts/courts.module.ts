import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Court } from '../entities/court.entity.js';
import { Camera } from '../entities/camera.entity.js';
import { CourtsController } from './courts.controller.js';
import { CourtsService } from './courts.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Court, Camera])],
  controllers: [CourtsController],
  providers: [CourtsService],
})
export class CourtsModule {}
