import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { Court } from './court.entity.js';

@Entity('facilities')
export class Facility {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', nullable: true })
  name: string | null;

  @Index({ unique: true })
  @Column({ type: 'varchar', nullable: true })
  slug: string | null;

  @OneToMany(() => Court, (court) => court.facility)
  courts: Relation<Court>[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
