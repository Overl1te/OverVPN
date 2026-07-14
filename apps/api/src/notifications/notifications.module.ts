import { Global, Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { TelegramNotificationService } from './telegram-notification.service';

@Global()
@Module({
  imports: [SettingsModule],
  providers: [TelegramNotificationService],
  exports: [TelegramNotificationService],
})
export class NotificationsModule {}
