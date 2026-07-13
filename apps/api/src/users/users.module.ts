import { Module } from '@nestjs/common';
import { InboundsModule } from '../inbounds/inbounds.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [InboundsModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
