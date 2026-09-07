import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Facility } from '../entities/facility.entity.js';

@Injectable()
export class FacilitiesService {
  constructor(
    @InjectRepository(Facility)
    private readonly facilities: Repository<Facility>,
  ) {}

  async findAll() {
    const facilities = await this.facilities.find({
      take: 50,
      order: { id: 'ASC' },
    });
    return facilities.map((facility) => ({
      id: facility.id,
      name: facility.name,
      slug: facility.slug,
    }));
  }

  async findOne(id: number) {
    const facility = await this.facilities.findOne({
      where: { id: String(id) },
      relations: { courts: true },
    });
    if (!facility) {
      throw new NotFoundException(`Facility ${id} not found`);
    }
    return {
      id: facility.id,
      name: facility.name,
      slug: facility.slug,
      createdAt: facility.createdAt,
      updatedAt: facility.updatedAt,
      courts: facility.courts.map((court) => ({
        id: court.id,
        name: court.name,
        slug: court.slug,
      })),
    };
  }
}
