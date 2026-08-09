import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InfrastructureModule } from '../infrastructure/infrastructure.module';
import { ProxyServersController } from './proxy-servers.controller';
import { ProxyServersService } from './proxy-servers.service';

@Module({
  imports: [AuthModule, InfrastructureModule],
  controllers: [ProxyServersController],
  providers: [ProxyServersService],
  exports: [ProxyServersService],
})
export class ProxyServersModule {}
