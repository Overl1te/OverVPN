import { Global, Module } from '@nestjs/common';
import {
  SupportIntegrityGuard,
  SupportIntegrityService,
} from './support-integrity';

@Global()
@Module({
  providers: [SupportIntegrityService, SupportIntegrityGuard],
  exports: [SupportIntegrityService, SupportIntegrityGuard],
})
export class SupportIntegrityModule {}
