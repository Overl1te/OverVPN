import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import {
  CoreFileSystem,
  CoreHttpAdapter,
  FetchCoreHttpAdapter,
  NodeCoreFileSystem,
  NodeProcessAdapter,
  ProcessAdapter,
  ReloadHandshakeAdapter,
  SharedVolumeReloadHandshakeAdapter,
} from './core-adapters';
import { CoreApplyService } from './core-apply.service';
import {
  CoreChangeDispatcher,
  DurableCoreChangeDispatcher,
} from './core-change-dispatcher';
import { CoreController } from './core.controller';
import { CoreProvider } from './core-provider';
import { CoreStateLoader } from './core-state.loader';
import { RedisDistributedLock } from './distributed-lock';
import { SingBoxProvider } from './sing-box.provider';
import {
  GrpcV2RayStatsAdapter,
  V2RayStatsAdapter,
} from './v2ray-stats.adapter';

@Global()
@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [CoreController],
  providers: [
    {
      provide: CoreChangeDispatcher,
      useClass: DurableCoreChangeDispatcher,
    },
    {
      provide: ProcessAdapter,
      useClass: NodeProcessAdapter,
    },
    {
      provide: CoreFileSystem,
      useClass: NodeCoreFileSystem,
    },
    {
      provide: ReloadHandshakeAdapter,
      useClass: SharedVolumeReloadHandshakeAdapter,
    },
    {
      provide: CoreHttpAdapter,
      useClass: FetchCoreHttpAdapter,
    },
    {
      provide: V2RayStatsAdapter,
      useClass: GrpcV2RayStatsAdapter,
    },
    {
      provide: CoreProvider,
      useClass: SingBoxProvider,
    },
    CoreStateLoader,
    RedisDistributedLock,
    CoreApplyService,
  ],
  exports: [
    CoreChangeDispatcher,
    CoreProvider,
    CoreApplyService,
    RedisDistributedLock,
    ProcessAdapter,
    CoreFileSystem,
    ReloadHandshakeAdapter,
  ],
})
export class CoreModule {}
