import { Global, Module } from '@nestjs/common';
import { TelegramNotificationService } from './telegram-notification.service';

@Global()
@Module({
  providers: [TelegramNotificationService],
  exports: [TelegramNotificationService],
})
export class NotificationsModule {}
