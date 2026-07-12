import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
  getSchemaPath,
  ApiExtraModels,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import type {
  AdminSummary,
  AuthenticatedSession,
  LoginRequest,
  LoginResponse,
  LogoutRequest,
  RefreshRequest,
  TotpConfirmRequest,
  TotpDisableRequest,
  TotpEnableRequest,
  TotpEnableResponse,
} from '@overvpn/shared/schemas';
import {
  loginRequestSchema,
  logoutRequestSchema,
  refreshRequestSchema,
  totpConfirmRequestSchema,
  totpDisableRequestSchema,
  totpEnableRequestSchema,
} from '@overvpn/shared/schemas';
import type { CookieOptions, Response } from 'express';
import { ApiException } from '../common/api-error';
import {
  AllowReadonlyMutation,
  CurrentAdmin,
  getRequestMetadata,
  Public,
  type AuthenticatedAdmin,
  type AuthenticatedRequest,
} from '../common/authorization';
import { ZodBody } from '../common/zod-validation';
import type { AppEnvironment } from '../config/environment';
import { AuthService } from './auth.service';

class AdminSummaryDto implements AdminSummary {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  username!: string;
  @ApiProperty({ enum: ['OWNER', 'ADMIN', 'READONLY'] })
  role!: 'OWNER' | 'ADMIN' | 'READONLY';
  @ApiProperty({ enum: ['en', 'ru'] })
  locale!: 'en' | 'ru';
  @ApiProperty()
  active!: boolean;
  @ApiProperty()
  totpEnabled!: boolean;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  lastLoginAt!: string | null;
}

class LoginRequestDto {
  @ApiProperty({ example: 'owner' })
  username!: string;
  @ApiProperty({ format: 'password', writeOnly: true })
  password!: string;
  @ApiPropertyOptional({ pattern: '^\\d{6}$', writeOnly: true })
  totpCode?: string;
  @ApiPropertyOptional({
    default: false,
    description:
      'CLI mode only. Also returns the refresh token in JSON; browsers should use the HttpOnly cookie.',
  })
  returnRefreshToken?: boolean;
}

class RefreshRequestDto {
  @ApiPropertyOptional({
    writeOnly: true,
    description:
      'Opaque CLI refresh token. Browser clients should omit this and use the HttpOnly cookie.',
  })
  refreshToken?: string;
}

class TotpEnableRequestDto {
  @ApiProperty({ format: 'password', writeOnly: true })
  currentPassword!: string;
  @ApiPropertyOptional({ pattern: '^\\d{6}$', writeOnly: true })
  currentTotpCode?: string;
}

class TotpConfirmRequestDto {
  @ApiProperty({ pattern: '^\\d{6}$', writeOnly: true })
  totpCode!: string;
}

class TotpDisableRequestDto extends TotpConfirmRequestDto {
  @ApiProperty({ format: 'password', writeOnly: true })
  currentPassword!: string;
}

class TotpEnableResponseDto implements TotpEnableResponse {
  @ApiProperty({
    description: 'Shown only once, before TOTP confirmation.',
    writeOnly: true,
  })
  secret!: string;
  @ApiProperty({ format: 'uri' })
  provisioningUri!: string;
}

class AuthenticatedSessionDto implements AuthenticatedSession {
  @ApiProperty({ enum: ['AUTHENTICATED'] })
  status!: 'AUTHENTICATED';
  @ApiProperty()
  accessToken!: string;
  @ApiProperty()
  accessTokenExpiresInSeconds!: number;
  @ApiPropertyOptional({
    description: 'Present only when CLI body-token mode was requested.',
  })
  refreshToken?: string;
  @ApiProperty({ type: AdminSummaryDto })
  admin!: AdminSummaryDto;
}

class TotpChallengeDto {
  @ApiProperty({ enum: ['TOTP_REQUIRED'] })
  status!: 'TOTP_REQUIRED';
  @ApiProperty({ enum: ['AUTH_TOTP_REQUIRED'] })
  code!: 'AUTH_TOTP_REQUIRED';
  @ApiProperty()
  message!: string;
  @ApiProperty()
  messageRu!: string;
}

@ApiTags('admin auth')
@ApiExtraModels(AuthenticatedSessionDto, TotpChallengeDto)
@Controller('admin/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<AppEnvironment, true>,
  ) {}

  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate an administrator' })
  @ApiBody({ type: LoginRequestDto })
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(AuthenticatedSessionDto) },
        { $ref: getSchemaPath(TotpChallengeDto) },
      ],
    },
  })
  async login(
    @ZodBody(loginRequestSchema) input: LoginRequest,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse> {
    const result = await this.auth.login(input, getRequestMetadata(request));
    if (result.refreshToken) {
      this.setRefreshCookie(response, result.refreshToken);
    }
    return result.response;
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth('overvpn_refresh')
  @ApiOperation({
    summary: 'Rotate a refresh token and issue a new access token',
  })
  @ApiBody({ type: RefreshRequestDto, required: false })
  @ApiOkResponse({ type: AuthenticatedSessionDto })
  async refresh(
    @ZodBody(refreshRequestSchema) input: RefreshRequest,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthenticatedSession> {
    const token = input.refreshToken ?? this.cookieToken(request);
    if (!token) {
      throw new ApiException('AUTH_TOKEN_INVALID', HttpStatus.UNAUTHORIZED);
    }
    const result = await this.auth.refresh(
      token,
      input.refreshToken !== undefined,
      getRequestMetadata(request),
    );
    this.setRefreshCookie(response, result.refreshToken!);
    return result.response as AuthenticatedSession;
  }

  @AllowReadonlyMutation()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiBody({ type: RefreshRequestDto, required: false })
  @ApiNoContentResponse()
  async logout(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @ZodBody(logoutRequestSchema) input: LogoutRequest,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(
      admin,
      input.refreshToken ?? this.cookieToken(request),
      getRequestMetadata(request),
    );
    response.clearCookie(
      this.config.get('AUTH_COOKIE_NAME', { infer: true }),
      this.cookieOptions(),
    );
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOkResponse({ type: AdminSummaryDto })
  me(@CurrentAdmin() admin: AuthenticatedAdmin): AdminSummary {
    return this.auth.me(admin);
  }

  @AllowReadonlyMutation()
  @Post('totp/enable')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiBody({ type: TotpEnableRequestDto })
  @ApiOkResponse({ type: TotpEnableResponseDto })
  enableTotp(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @ZodBody(totpEnableRequestSchema) input: TotpEnableRequest,
    @Req() request: AuthenticatedRequest,
  ): Promise<TotpEnableResponse> {
    return this.auth.enableTotp(admin, input, getRequestMetadata(request));
  }

  @AllowReadonlyMutation()
  @Post('totp/confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiBody({ type: TotpConfirmRequestDto })
  @ApiNoContentResponse()
  confirmTotp(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @ZodBody(totpConfirmRequestSchema) input: TotpConfirmRequest,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    return this.auth.confirmTotp(
      admin,
      input.totpCode,
      getRequestMetadata(request),
    );
  }

  @AllowReadonlyMutation()
  @Delete('totp/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiBody({ type: TotpDisableRequestDto })
  @ApiNoContentResponse()
  disableTotp(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @ZodBody(totpDisableRequestSchema) input: TotpDisableRequest,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    return this.auth.disableTotp(admin, input, getRequestMetadata(request));
  }

  private setRefreshCookie(response: Response, token: string): void {
    response.cookie(
      this.config.get('AUTH_COOKIE_NAME', { infer: true }),
      token,
      {
        ...this.cookieOptions(),
        maxAge:
          this.config.get('REFRESH_TOKEN_TTL_SECONDS', { infer: true }) * 1_000,
      },
    );
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.get('AUTH_COOKIE_SECURE', { infer: true }),
      sameSite: this.config.get('AUTH_COOKIE_SAME_SITE', { infer: true }),
      domain: this.config.get('AUTH_COOKIE_DOMAIN', { infer: true }),
      path: this.config.get('AUTH_COOKIE_PATH', { infer: true }),
    };
  }

  private cookieToken(request: AuthenticatedRequest): string | undefined {
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const value =
      cookies?.[this.config.get('AUTH_COOKIE_NAME', { infer: true })];
    return typeof value === 'string' ? value : undefined;
  }
}
