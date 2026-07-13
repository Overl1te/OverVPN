import { Module } from '@nestjs/common';
import { InboundsModule } from '../inbounds/inbounds.module';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';

@Module({
  imports: [InboundsModule],
  controllers: [PlansController],
  providers: [PlansService],
})
export class PlansModule {}
