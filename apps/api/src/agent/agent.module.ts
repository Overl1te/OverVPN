import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InfrastructureModule } from '../infrastructure/infrastructure.module';
import { AgentController } from './agent.controller';
import { InstallTokenGuard, NodeTokenGuard } from './agent.guards';
import { AgentService } from './agent.service';

@Module({
  imports: [AuthModule, InfrastructureModule],
  controllers: [AgentController],
  providers: [AgentService, InstallTokenGuard, NodeTokenGuard],
  exports: [AgentService],
})
export class AgentModule {}
