import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import {
  PasswordService,
  SecretEncryptionService,
  TotpService,
} from './auth-crypto';
import { AuthService } from './auth.service';

@Module({
  imports: [JwtModule.register({ global: true })],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    SecretEncryptionService,
    TotpService,
  ],
  exports: [PasswordService, SecretEncryptionService],
})
export class AuthModule {}
