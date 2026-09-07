import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { validate } from './config/env.validation.js';
import { HealthModule } from './health/health.module.js';
import { FacilitiesModule } from './facilities/facilities.module.js';
import { CourtsModule } from './courts/courts.module.js';
import { SessionsModule } from './sessions/sessions.module.js';
import { Facility } from './entities/facility.entity.js';
import { Court } from './entities/court.entity.js';
import { Camera } from './entities/camera.entity.js';
import { Session } from './entities/session.entity.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL'),
        entities: [Facility, Court, Camera, Session],
        synchronize: false,
      }),
    }),
    HealthModule,
    FacilitiesModule,
    CourtsModule,
    SessionsModule,
  ],
})
export class AppModule {}
