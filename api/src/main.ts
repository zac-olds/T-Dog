import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './configure-app.js';

async function bootstrap() {
  // rawBody is required for Stripe webhook signature verification.
  const app = configureApp(
    await NestFactory.create<NestExpressApplication>(AppModule, {
      rawBody: true,
    }),
  );
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
