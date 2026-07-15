import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CompositeCoreProvider } from './composite-core.provider';
import {
  CoreFileSystem,
  CoreHttpAdapter,
  FetchCoreHttpAdapter,
  MtproxyReloadHandshakeAdapter,
  NodeCoreFileSystem,
  NodeProcessAdapter,
  ProcessAdapter,
  ReloadHandshakeAdapter,
  SharedVolumeMtproxyReloadHandshakeAdapter,
  SharedVolumeReloadHandshakeAdapter,
  SharedVolumeXrayReloadHandshakeAdapter,
  XrayReloadHandshakeAdapter,
} from './core-adapters';
import { CoreApplyService } from './core-apply.service';
import {
  CORE_ENGINE_PROVIDERS,
  CoreEngineRegistry,
} from './core-engine.registry';
import {
  CoreChangeDispatcher,
  DurableCoreChangeDispatcher,
} from './core-change-dispatcher';
import { CoreController } from './core.controller';
import { CoreProvider, type EngineProvider } from './core-provider';
import { CoreStateLoader } from './core-state.loader';
import { RedisDistributedLock } from './distributed-lock';
import { MtproxyProvider } from './mtproxy.provider';
import { SingBoxProvider } from './sing-box.provider';
import {
  GrpcV2RayStatsAdapter,
  V2RayStatsAdapter,
} from './v2ray-stats.adapter';
import { XrayProvider } from './xray.provider';
import { GrpcXrayStatsAdapter, XrayStatsAdapter } from './xray-stats.adapter';

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
      provide: XrayReloadHandshakeAdapter,
      useClass: SharedVolumeXrayReloadHandshakeAdapter,
    },
    {
      provide: MtproxyReloadHandshakeAdapter,
      useClass: SharedVolumeMtproxyReloadHandshakeAdapter,
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
      provide: XrayStatsAdapter,
      useClass: GrpcXrayStatsAdapter,
    },
    SingBoxProvider,
    XrayProvider,
    MtproxyProvider,
    {
      provide: CORE_ENGINE_PROVIDERS,
      inject: [SingBoxProvider, XrayProvider, MtproxyProvider],
      useFactory: (
        singBoxProvider: SingBoxProvider,
        xrayProvider: XrayProvider,
        mtproxyProvider: MtproxyProvider,
      ): readonly EngineProvider[] => [
        singBoxProvider,
        xrayProvider,
        mtproxyProvider,
      ],
    },
    CoreEngineRegistry,
    CompositeCoreProvider,
    {
      provide: CoreProvider,
      useExisting: CompositeCoreProvider,
    },
    CoreStateLoader,
    RedisDistributedLock,
    CoreApplyService,
  ],
  exports: [
    CoreChangeDispatcher,
    CoreProvider,
    CoreEngineRegistry,
    CoreApplyService,
    RedisDistributedLock,
    ProcessAdapter,
    CoreFileSystem,
    ReloadHandshakeAdapter,
    XrayReloadHandshakeAdapter,
    MtproxyReloadHandshakeAdapter,
  ],
})
export class CoreModule {}
