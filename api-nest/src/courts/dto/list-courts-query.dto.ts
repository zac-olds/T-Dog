import { IsOptional, IsString } from 'class-validator';

export class ListCourtsQueryDto {
  @IsOptional()
  @IsString()
  slug?: string;
}
