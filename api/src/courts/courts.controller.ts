import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { CourtsService } from './courts.service.js';
import { ListCourtsQueryDto } from './dto/list-courts-query.dto.js';

@Controller('courts')
export class CourtsController {
  constructor(private readonly courtsService: CourtsService) {}

  @Get()
  findAll(@Query() query: ListCourtsQueryDto) {
    return this.courtsService.findAll(query.slug);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.courtsService.findOne(id);
  }
}
