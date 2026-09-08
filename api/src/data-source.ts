import 'dotenv/config';
import { DataSource } from 'typeorm';
import { Facility } from './entities/facility.entity.js';
import { Court } from './entities/court.entity.js';
import { Camera } from './entities/camera.entity.js';
import { Session } from './entities/session.entity.js';

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [Facility, Court, Camera, Session],
  migrations: ['src/migrations/*.ts'],
  synchronize: false,
});
