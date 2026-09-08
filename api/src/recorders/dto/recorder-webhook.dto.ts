import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString } from 'class-validator';

/**
 * Field names match the external recorder service's webhook payload
 * (snake_case), not this app's own camelCase convention — we don't control
 * that service's wire format.
 */
export class RecorderWebhookDto {
  @IsString()
  event: string;

  @IsOptional()
  @IsString()
  session_id?: string;

  @IsOptional()
  @IsString()
  s3_key?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  duration_s?: number;
}
