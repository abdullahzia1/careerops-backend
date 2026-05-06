/**
 * AWS Lambda adapter for the NestJS application.
 *
 * Usage (once deployed to Lambda):
 *   1. Install: npm install @vendia/serverless-express
 *   2. Set handler in serverless.yml / SAM template to: dist/lambda.handler
 *   3. Uncomment the implementation below.
 *
 * The in-memory store is replaced by DynamoDB/RDS in production; this file
 * only handles the HTTP adapter layer.
 */

// import { NestFactory } from '@nestjs/core';
// import { configure as serverlessExpress } from '@vendia/serverless-express';
// import type { Handler } from 'aws-lambda';
// import { AppModule } from './app.module';
//
// let cachedHandler: Handler;
//
// export async function handler(event: unknown, context: unknown) {
//   if (!cachedHandler) {
//     const app = await NestFactory.create(AppModule);
//     await app.init();
//     cachedHandler = serverlessExpress({ app: app.getHttpAdapter().getInstance() });
//   }
//   return cachedHandler(event, context, () => undefined);
// }

export {};
