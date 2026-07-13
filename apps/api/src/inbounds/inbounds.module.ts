import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CoreModule } from '../core/core.module';
import {
  InboundCreateValidationPipe,
  InboundUpdateValidationPipe,
} from './inbound-validation.pipe';
import { InboundsController } from './inbounds.controller';
import { InboundsService } from './inbounds.service';
import { PlanAssignmentSyncService } from './plan-assignment-sync.service';

@Module({
  imports: [AuthModule, CoreModule],
  controllers: [InboundsController],
  providers: [
    InboundsService,
    PlanAssignmentSyncService,
    InboundCreateValidationPipe,
    InboundUpdateValidationPipe,
  ],
  exports: [PlanAssignmentSyncService],
})
export class InboundsModule {}
