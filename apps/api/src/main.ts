import './load-env';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { env } from './common/env';

async function main() {
  const config = env(); // validate early
  const app = configureApp(await NestFactory.create(AppModule, { bodyParser: true }));
  await app.listen(config.PORT);
  Logger.log(`FG One API listening on http://localhost:${config.PORT}/api`, 'Bootstrap');
}
void main();
