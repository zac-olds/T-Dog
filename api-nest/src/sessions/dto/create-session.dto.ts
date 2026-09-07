import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString } from 'class-validator';

export class CreateSessionDto {
  @IsInt()
  @Type(() => Number)
  courtId: number;

  @IsOptional()
  @IsString()
  userContact?: string;
}
