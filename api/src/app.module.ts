import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { BullModule } from '@nestjs/bullmq';
import { Redis } from 'ioredis';
import { validate } from './config/env.validation.js';
import { HealthModule } from './health/health.module.js';
import { FacilitiesModule } from './facilities/facilities.module.js';
import { CourtsModule } from './courts/courts.module.js';
import { SessionsModule } from './sessions/sessions.module.js';
import { RecordersModule } from './recorders/recorders.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { StripeWebhooksModule } from './stripe-webhooks/stripe-webhooks.module.js';
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
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { algorithm: 'HS256', expiresIn: '12h' },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: new Redis(
          config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
          { maxRetriesPerRequest: null },
        ),
      }),
    }),
    HealthModule,
    FacilitiesModule,
    CourtsModule,
    SessionsModule,
    RecordersModule,
    PaymentsModule,
    StripeWebhooksModule,
  ],
})
export class AppModule {}
