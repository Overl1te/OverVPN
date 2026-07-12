import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CoreModule } from '../core/core.module';
import { BackupsController } from './backups.controller';
import {
  BackupFileSystem,
  BackupsService,
  NodeBackupFileSystem,
} from './backups.service';

@Module({
  imports: [AuthModule, CoreModule],
  controllers: [BackupsController],
  providers: [
    BackupsService,
    {
      provide: BackupFileSystem,
      useClass: NodeBackupFileSystem,
    },
  ],
  exports: [BackupsService],
})
export class BackupsModule {}
