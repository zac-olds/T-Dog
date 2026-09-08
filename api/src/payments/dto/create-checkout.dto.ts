import { Type } from 'class-transformer';
import { IsInt } from 'class-validator';

export class CreateCheckoutDto {
  @IsInt()
  @Type(() => Number)
  sessionId: number;
}
