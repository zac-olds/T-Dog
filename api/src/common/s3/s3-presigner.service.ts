import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class S3PresignerService {
  private readonly client: S3Client;
  private readonly bucket: string | undefined;

  constructor(config: ConfigService) {
    this.client = new S3Client({ region: config.get<string>('AWS_REGION') });
    this.bucket = config.get<string>('S3_BUCKET');
  }

  presignDownload(key: string, expiresIn = 3600): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn });
  }
}
