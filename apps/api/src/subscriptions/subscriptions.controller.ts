import {
  Controller,
  Get,
  HttpStatus,
  Param,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { SubscriptionFormat } from '@overvpn/shared/constants';
import { SUBSCRIPTION_FORMATS } from '@overvpn/shared/constants';
import type {
  SubscriptionInfo,
  SubscriptionQuery,
} from '@overvpn/shared/schemas';
import { subscriptionQuerySchema } from '@overvpn/shared/schemas';
import type { Request, Response } from 'express';
import { ApiException } from '../common/api-error';
import { Public } from '../common/authorization';
import { ZodQuery } from '../common/zod-validation';
import { SubscriptionProfileBuilder } from './subscription-profile';
import { SubscriptionRateLimitGuard } from './subscription-rate-limit';
import {
  prefersSubscriptionHtmlPage,
  renderSubscriptionStatusPage,
} from './subscription-status-page';
import {
  formatSubscriptionUserinfo,
  SubscriptionsService,
} from './subscriptions.service';

class SubscriptionFormatUrlsDto {
  @ApiProperty({ format: 'uri' })
  singBox!: string;
  @ApiProperty({ format: 'uri' })
  links!: string;
  @ApiProperty({ format: 'uri' })
  clash!: string;
}

class SubscriptionInfoDto implements SubscriptionInfo {
  @ApiProperty()
  identity!: string;
  @ApiProperty()
  username!: string;
  @ApiProperty({ enum: ['ACTIVE', 'DISABLED', 'EXPIRED', 'LIMITED'] })
  status!: 'ACTIVE' | 'DISABLED' | 'EXPIRED' | 'LIMITED';
  @ApiPropertyOptional({
    enum: ['manual', 'expired', 'quota', 'device', 'ip'],
    nullable: true,
  })
  statusReason!: 'manual' | 'expired' | 'quota' | 'device' | 'ip' | null;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  expireAt!: string | null;
  @ApiProperty({ type: String })
  uploadBytes!: string;
  @ApiProperty({ type: String })
  downloadBytes!: string;
  @ApiProperty({ type: String })
  totalBytes!: string;
  @ApiPropertyOptional({ type: String, nullable: true })
  limitBytes!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  remainingBytes!: string | null;
  @ApiProperty({ minimum: 1, description: 'Client refresh interval in hours.' })
  updateIntervalHours!: number;
  @ApiProperty({ description: 'Resolved profile title for VPN clients.' })
  profileTitle!: string;
  @ApiPropertyOptional({ nullable: true, maxLength: 500 })
  announce!: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'uri' })
  supportUrl!: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'uri' })
  profileWebPageUrl!: string | null;
  @ApiProperty({ format: 'uri' })
  subscriptionUrl!: string;
  @ApiProperty({ enum: SUBSCRIPTION_FORMATS, isArray: true })
  formats!: SubscriptionFormat[];
  @ApiProperty({ type: SubscriptionFormatUrlsDto })
  formatUrls!: SubscriptionFormatUrlsDto;
}

const profileResponseHeaders = {
  'subscription-userinfo': {
    description:
      'Decimal usage counters; total and expire are omitted for unlimited/non-expiring subscriptions.',
    schema: { type: 'string' },
  },
  'profile-update-interval': {
    description: 'Recommended refresh interval in hours.',
    schema: { type: 'integer' },
  },
  'profile-title': {
    description: 'UTF-8 profile title encoded as base64:<base64>.',
    schema: { type: 'string' },
  },
  announce: {
    description: 'Optional UTF-8 announcement encoded as base64:<base64>.',
    schema: { type: 'string' },
  },
  'support-url': {
    description: 'Optional support / Telegram URL for clients.',
    schema: { type: 'string', format: 'uri' },
  },
  'profile-web-page-url': {
    description: 'Optional informational web page URL for clients.',
    schema: { type: 'string', format: 'uri' },
  },
  'RateLimit-Limit': {
    description: 'Effective request limit for the active window.',
    schema: { type: 'integer' },
  },
  'RateLimit-Remaining': {
    description: 'Requests remaining in the active window.',
    schema: { type: 'integer' },
  },
  'RateLimit-Reset': {
    description: 'Seconds until the active rate-limit window resets.',
    schema: { type: 'integer' },
  },
  'RateLimit-Policy': {
    description: 'Effective fixed-window rate-limit policy.',
    schema: { type: 'string' },
  },
  'Cache-Control': {
    description: 'Always no-store for token-bearing subscription responses.',
    schema: { type: 'string', example: 'no-store, max-age=0' },
  },
  'X-Content-Type-Options': {
    description: 'Disables MIME sniffing.',
    schema: { type: 'string', example: 'nosniff' },
  },
} as const;

@ApiTags('public subscriptions')
@Public()
@UseGuards(SubscriptionRateLimitGuard)
@Controller('sub')
export class SubscriptionsController {
  constructor(
    private readonly subscriptions: SubscriptionsService,
    private readonly profiles: SubscriptionProfileBuilder,
  ) {}

  @Get(':token')
  @ApiOperation({
    summary: 'Download a public subscription profile',
    description:
      'Public token-authenticated endpoint. It deliberately bypasses administrator JWT authentication, validates and rate-limits the opaque URL token, and never accepts admin credentials as a substitute.',
  })
  @ApiParam({
    name: 'token',
    description: 'Opaque 32-byte base64url subscription token.',
    schema: {
      type: 'string',
      pattern: '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$',
    },
  })
  @ApiQuery({
    name: 'format',
    required: false,
    enum: SUBSCRIPTION_FORMATS,
    type: String,
  })
  @ApiProduces('application/json', 'text/plain', 'application/yaml')
  @ApiResponse({
    status: 200,
    description: 'A usable profile in the negotiated format.',
    headers: {
      ...profileResponseHeaders,
      'Content-Disposition': {
        description: 'Suggested deterministic profile filename.',
        schema: { type: 'string' },
      },
    },
    content: {
      'application/json': {
        schema: { type: 'object', additionalProperties: true },
      },
      'text/plain': {
        schema: {
          type: 'string',
          description: 'Newline-delimited Hysteria2 share URIs.',
        },
      },
      'application/yaml': {
        schema: { type: 'string', description: 'Mihomo/Clash Meta YAML.' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'The explicit format query is unsupported.',
  })
  @ApiResponse({
    status: 403,
    description: 'The token is valid but the subscription is inactive.',
  })
  @ApiResponse({
    status: 404,
    description:
      'Invalid-shape, unknown, rotated, and deleted-user tokens share this response.',
  })
  @ApiResponse({
    status: 409,
    description: 'No enabled assigned servers are available.',
  })
  @ApiResponse({
    status: 429,
    description: 'Source-IP or token-fingerprint rate limit exceeded.',
    headers: {
      ...profileResponseHeaders,
      'Retry-After': {
        description: 'Seconds until a retry is allowed.',
        schema: { type: 'integer' },
      },
    },
  })
  @ApiResponse({
    status: 503,
    description:
      'Fail-closed response when Redis or required profile material is unavailable.',
    headers: {
      'Retry-After': {
        description: 'Suggested retry delay when supplied.',
        schema: { type: 'integer' },
      },
    },
  })
  async profile(
    @Param('token') token: string,
    // Use the Zod-inferred type (not a class) so the global ValidationPipe
    // does not reject `?format=` via forbidNonWhitelisted.
    @ZodQuery(subscriptionQuerySchema) query: SubscriptionQuery,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const accept = request.headers.accept;
    const userAgent = request.headers['user-agent'];
    if (prefersSubscriptionHtmlPage(query.format, accept, userAgent)) {
      const info = await this.subscriptions.info(token);
      setSubscriptionHeaders(response, info, true);
      response.type('text/html; charset=utf-8');
      return renderSubscriptionStatusPage(
        info,
        headerValue(request.headers['accept-language']),
      );
    }

    const access = await this.subscriptions.profile(token);
    setSubscriptionHeaders(response, access.info);
    if (access.kind === 'inactive') {
      throw new ApiException('SUBSCRIPTION_INACTIVE', HttpStatus.FORBIDDEN);
    }
    if (access.kind === 'empty') {
      throw new ApiException('SUBSCRIPTION_EMPTY', HttpStatus.CONFLICT);
    }

    const format = negotiateSubscriptionFormat(query.format, accept, userAgent);
    const rendered = this.profiles.render(format, access.profile);
    response.type(rendered.contentType);
    response.setHeader(
      'Content-Disposition',
      contentDisposition(access.info.username, rendered.extension),
    );
    return rendered.body;
  }

  @Get(':token/info')
  @ApiOperation({
    summary: 'Read public subscription status and usage',
    description:
      'Public token-authenticated endpoint with the same fail-closed Redis rate limit as profile downloads. It contains no assignment credentials or inbound secret material.',
  })
  @ApiParam({
    name: 'token',
    description: 'Opaque 32-byte base64url subscription token.',
    schema: {
      type: 'string',
      pattern: '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$',
    },
  })
  @ApiOkResponse({
    type: SubscriptionInfoDto,
    headers: profileResponseHeaders,
  })
  @ApiResponse({
    status: 404,
    description:
      'Invalid-shape, unknown, rotated, and deleted-user tokens share this response.',
  })
  @ApiResponse({
    status: 429,
    description: 'Source-IP or token-fingerprint rate limit exceeded.',
  })
  @ApiResponse({
    status: 503,
    description: 'Fail-closed response when Redis is unavailable.',
  })
  async info(
    @Param('token') token: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SubscriptionInfo> {
    const info = await this.subscriptions.info(token);
    setSubscriptionHeaders(response, info);
    return info;
  }
}

export function negotiateSubscriptionFormat(
  explicit: SubscriptionFormat | undefined,
  accept: string | undefined,
  userAgent: string | undefined,
): SubscriptionFormat {
  if (explicit) {
    return explicit;
  }

  const accepted = preferredAcceptFormat(accept);
  if (accepted) {
    return accepted;
  }

  const client = userAgent?.toLowerCase() ?? '';
  if (/(?:mihomo|clash|stash|flclash)/.test(client)) {
    return 'clash';
  }
  if (
    /(?:v2rayn|v2rayng|v2raytun|shadowrocket|surge|happ|hiddify|nekoray|nekobox|streisand)/.test(
      client,
    )
  ) {
    return 'links';
  }
  return 'sing-box';
}

function preferredAcceptFormat(
  accept: string | undefined,
): SubscriptionFormat | undefined {
  if (!accept) {
    return undefined;
  }
  const entries = accept
    .split(',')
    .map((entry, index) => {
      const [mime = '', ...parameters] = entry.trim().toLowerCase().split(';');
      const quality = parameters
        .map((parameter) => parameter.trim())
        .find((parameter) => parameter.startsWith('q='));
      const parsedQuality = quality ? Number(quality.slice(2)) : 1;
      return {
        mime,
        quality: Number.isFinite(parsedQuality) ? parsedQuality : 0,
        index,
      };
    })
    .filter((entry) => entry.quality > 0 && entry.mime !== '*/*')
    .sort(
      (left, right) => right.quality - left.quality || left.index - right.index,
    );

  for (const entry of entries) {
    if (
      [
        'application/yaml',
        'application/x-yaml',
        'text/yaml',
        'text/x-yaml',
      ].includes(entry.mime)
    ) {
      return 'clash';
    }
    if (entry.mime === 'text/plain') {
      return 'links';
    }
    if (
      [
        'application/json',
        'application/vnd.sing-box+json',
        'application/*',
      ].includes(entry.mime)
    ) {
      return 'sing-box';
    }
  }
  return undefined;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function setSubscriptionHeaders(
  response: Response,
  info: SubscriptionInfo,
  htmlPage = false,
): void {
  response.setHeader('subscription-userinfo', formatSubscriptionUserinfo(info));
  response.setHeader(
    'profile-update-interval',
    info.updateIntervalHours.toString(),
  );
  response.setHeader(
    'profile-title',
    `base64:${Buffer.from(info.profileTitle, 'utf8').toString('base64')}`,
  );
  if (info.announce) {
    response.setHeader(
      'announce',
      `base64:${Buffer.from(info.announce, 'utf8').toString('base64')}`,
    );
  }
  if (info.supportUrl) {
    response.setHeader('support-url', info.supportUrl);
  }
  if (info.profileWebPageUrl) {
    response.setHeader('profile-web-page-url', info.profileWebPageUrl);
  }
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader(
    'Vary',
    htmlPage ? 'Accept, User-Agent, Accept-Language' : 'Accept, User-Agent',
  );
}

function contentDisposition(
  username: string,
  extension: 'json' | 'txt' | 'yaml',
): string {
  const safeName =
    username
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'subscription';
  const filename = `overvpn-${safeName}.${extension}`;
  return `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(
    filename,
  )}`;
}
