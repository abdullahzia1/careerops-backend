import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = app.get(ConfigService);
  const port = config.get<number>('PORT') ?? 3001;
  const frontendOrigin =
    config.get<string>('FRONTEND_ORIGIN') ?? 'http://localhost:5173';

  app.enableCors({
    origin: frontendOrigin,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'If-Match'],
    exposedHeaders: ['ETag'],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // /health is excluded so it lives at /health, not /api/v1/health
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });

  const swaggerCfg = new DocumentBuilder()
    .setTitle('Career Ops API')
    .setDescription('AI-powered job search pipeline API')
    .setVersion('1.0')
    .addTag('health')
    .addTag('me')
    .addTag('evaluations')
    .addTag('scan')
    .addTag('patterns')
    .addTag('pdf')
    .addTag('liveness')
    .addTag('followups')
    .addTag('tracker')
    .addTag('system')
    .addTag('latex')
    .build();
  SwaggerModule.setup(
    'api-docs',
    app,
    SwaggerModule.createDocument(app, swaggerCfg),
  );

  await app.listen(port, '0.0.0.0');

  const logger = new Logger('Bootstrap');
  logger.log(`Server       : http://localhost:${port}`);
  logger.log(`Swagger docs : http://localhost:${port}/api-docs`);
  logger.log(`CORS origin  : ${frontendOrigin}`);
  logger.log(
    `Gemini model : ${config.get<string>('GEMINI_MODEL') ?? '(not set)'}`,
  );
}

void bootstrap();
