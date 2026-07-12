import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module';
import { WorkersModule } from '../workers/workers.module';
import {
  OnlineSessionsController,
  SystemController,
} from './system.controller';
import { SystemService } from './system.service';

@Module({
  imports: [CoreModule, WorkersModule],
  controllers: [OnlineSessionsController, SystemController],
  providers: [SystemService],
})
export class SystemModule {}
