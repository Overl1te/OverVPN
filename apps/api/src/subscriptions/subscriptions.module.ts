import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import {
  Hysteria2SubscriptionAdapter,
  ShadowsocksSubscriptionAdapter,
  ShadowsocksXraySubscriptionAdapter,
  SubscriptionProfileBuilder,
  TrojanSubscriptionAdapter,
  TrojanTlsSubscriptionAdapter,
  VlessGrpcTlsSubscriptionAdapter,
  VlessRealitySubscriptionAdapter,
  VlessTcpTlsSubscriptionAdapter,
  VlessXhttpTlsSubscriptionAdapter,
  WireguardSubscriptionAdapter,
  WireguardXraySubscriptionAdapter,
} from './subscription-profile';
import {
  SubscriptionRateLimitGuard,
  SubscriptionRateLimiter,
  SubscriptionRateLimitStore,
} from './subscription-rate-limit';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  imports: [AuthModule],
  controllers: [SubscriptionsController],
  providers: [
    Hysteria2SubscriptionAdapter,
    VlessRealitySubscriptionAdapter,
    VlessXhttpTlsSubscriptionAdapter,
    VlessGrpcTlsSubscriptionAdapter,
    VlessTcpTlsSubscriptionAdapter,
    TrojanSubscriptionAdapter,
    TrojanTlsSubscriptionAdapter,
    ShadowsocksSubscriptionAdapter,
    ShadowsocksXraySubscriptionAdapter,
    WireguardSubscriptionAdapter,
    WireguardXraySubscriptionAdapter,
    SubscriptionProfileBuilder,
    SubscriptionRateLimitStore,
    SubscriptionRateLimiter,
    SubscriptionRateLimitGuard,
    SubscriptionsService,
  ],
})
export class SubscriptionsModule {}
