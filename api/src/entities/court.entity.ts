import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { Facility } from './facility.entity.js';
import { Camera } from './camera.entity.js';

@Entity('courts')
export class Court {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'facility_id', type: 'bigint' })
  facilityId: string;

  @Index()
  @ManyToOne(() => Facility, (facility) => facility.courts)
  @JoinColumn({ name: 'facility_id' })
  facility: Relation<Facility>;

  @Column({ type: 'varchar', nullable: true })
  name: string | null;

  @Index({ unique: true })
  @Column({ type: 'varchar', nullable: true })
  slug: string | null;

  /**
   * Carried over from the Rails schema as-is. The real court<->camera
   * relationship is via cameras.court_id (see Camera#court below) — this
   * column is unused by any application code in the Rails app either.
   */
  @Column({ name: 'camera_id', type: 'integer', nullable: true })
  cameraId: number | null;

  @OneToOne(() => Camera, (camera) => camera.court)
  camera: Relation<Camera>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
