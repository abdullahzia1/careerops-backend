import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { resolve } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const config = app.get(ConfigService);
  const port = config.get<number>('PORT') ?? 3001;
  const rawOrigin =
    config.get<string>('FRONTEND_ORIGIN') ?? 'http://localhost:5173';
  const frontendOrigin = rawOrigin.includes(',')
    ? rawOrigin.split(',').map((o) => o.trim())
    : rawOrigin;

  app.enableCors({
    origin: frontendOrigin,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'If-Match'],
    exposedHeaders: ['ETag'],
    credentials: true,
  });

  // Serve woff/woff2 fonts to the browser-based CV preview.
  // The PDF render path keeps using file:// — see PdfService.patchFontPaths.
  // CORS is wide-open here because @font-face requires it from cross-origin iframes.
  app.useStaticAssets(resolve(__dirname, '../fonts'), {
    prefix: '/assets/fonts',
    setHeaders: (res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=86400');
    },
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
    .addTag('jd')
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
  logger.log(
    `CORS origin  : ${Array.isArray(frontendOrigin) ? frontendOrigin.join(', ') : frontendOrigin}`,
  );
  logger.log(
    `Gemini model : ${config.get<string>('GEMINI_MODEL') ?? '(not set)'}`,
  );
}

void bootstrap();
