import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { Court } from './court.entity.js';

@Entity('cameras')
export class Camera {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'court_id', type: 'bigint' })
  courtId: string;

  @OneToOne(() => Court, (court) => court.camera)
  @JoinColumn({ name: 'court_id' })
  court: Relation<Court>;

  @Column({ name: 'rtsp_url', type: 'varchar', nullable: true })
  rtspUrl: string | null;

  @Column({ name: 'onvif_url', type: 'varchar', nullable: true })
  onvifUrl: string | null;

  @Column({ type: 'varchar', nullable: true })
  make: string | null;

  @Column({ type: 'varchar', nullable: true })
  model: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
