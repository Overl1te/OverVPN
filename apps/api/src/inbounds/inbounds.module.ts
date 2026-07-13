import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CoreModule } from '../core/core.module';
import {
  InboundCreateValidationPipe,
  InboundUpdateValidationPipe,
} from './inbound-validation.pipe';
import { InboundsController } from './inbounds.controller';
import { InboundsService } from './inbounds.service';

@Module({
  imports: [AuthModule, CoreModule],
  controllers: [InboundsController],
  providers: [InboundsService, InboundCreateValidationPipe, InboundUpdateValidationPipe],
})
export class InboundsModule {}
