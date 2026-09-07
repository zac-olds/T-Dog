import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Court } from './court.entity.js';

@Entity('sessions')
export class Session {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'court_id', type: 'bigint' })
  courtId: string;

  @Index()
  @ManyToOne(() => Court)
  @JoinColumn({ name: 'court_id' })
  court: Court;

  @Column({ name: 'user_contact', type: 'varchar', nullable: true })
  userContact: string | null;

  @Column({ type: 'varchar', nullable: true })
  status: string | null;

  @Column({ name: 'started_at', type: 'timestamp', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'ended_at', type: 'timestamp', nullable: true })
  endedAt: Date | null;

  @Column({ name: 'duration_s', type: 'integer', nullable: true })
  durationS: number | null;

  @Column({ name: 's3_key', type: 'varchar', nullable: true })
  s3Key: string | null;

  @Index()
  @Column({ type: 'varchar', nullable: true })
  token: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
