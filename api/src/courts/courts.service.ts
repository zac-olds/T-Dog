import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Court } from '../entities/court.entity.js';
import { Camera } from '../entities/camera.entity.js';

function serializeCamera(camera: Camera | null | undefined) {
  if (!camera) return null;
  return {
    id: camera.id,
    rtspUrl: camera.rtspUrl,
    onvifUrl: camera.onvifUrl,
    make: camera.make,
    model: camera.model,
  };
}

@Injectable()
export class CourtsService {
  constructor(
    @InjectRepository(Court) private readonly courts: Repository<Court>,
  ) {}

  async findAll(slug?: string) {
    if (slug) {
      const courts = await this.courts.find({
        where: { slug },
        relations: { camera: true },
      });
      return courts.map((court) => ({
        id: court.id,
        name: court.name,
        slug: court.slug,
        facilityId: court.facilityId,
        camera: serializeCamera(court.camera),
      }));
    }

    const courts = await this.courts.find({
      take: 50,
      order: { id: 'ASC' },
    });
    return courts.map((court) => ({
      id: court.id,
      name: court.name,
      slug: court.slug,
    }));
  }

  async findOne(id: number) {
    const court = await this.courts.findOne({
      where: { id: String(id) },
      relations: { camera: true },
    });
    if (!court) {
      throw new NotFoundException(`Court ${id} not found`);
    }
    return {
      id: court.id,
      facilityId: court.facilityId,
      name: court.name,
      slug: court.slug,
      createdAt: court.createdAt,
      updatedAt: court.updatedAt,
      camera: court.camera
        ? {
            id: court.camera.id,
            courtId: court.camera.courtId,
            rtspUrl: court.camera.rtspUrl,
            onvifUrl: court.camera.onvifUrl,
            make: court.camera.make,
            model: court.camera.model,
            createdAt: court.camera.createdAt,
            updatedAt: court.camera.updatedAt,
          }
        : null,
    };
  }
}
