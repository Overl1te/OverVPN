import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Body,
} from '@nestjs/common';
import { INBOUND_PROTOCOLS } from '@overvpn/shared/constants';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import type {
  AddAssignment,
  AssignmentListQuery,
  CreateInbound,
  InboundListQuery,
  RotateAssignmentCredential,
  UpdateInbound,
} from '@overvpn/shared/schemas';
import {
  addAssignmentSchema,
  assignmentListQuerySchema,
  idSchema,
  inboundListQuerySchema,
  rotateAssignmentCredentialSchema,
} from '@overvpn/shared/schemas';
import {
  CurrentAdmin,
  getRequestMetadata,
  Roles,
  type AuthenticatedAdmin,
  type AuthenticatedRequest,
} from '../common/authorization';
import { ZodBody, ZodParam, ZodQuery } from '../common/zod-validation';
import {
  InboundCreateValidationPipe,
  InboundUpdateValidationPipe,
} from './inbound-validation.pipe';
import { InboundsService } from './inbounds.service';

class CreateInboundDto {
  @ApiProperty({ maxLength: 100 })
  tag!: string;
  @ApiProperty({ enum: INBOUND_PROTOCOLS })
  protocol!: (typeof INBOUND_PROTOCOLS)[number];
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'Protocol-specific inbound settings. Shape depends on protocol discriminator.',
  })
  settings!: Record<string, unknown>;
}

class UpdateInboundDto {
  @ApiPropertyOptional({ maxLength: 100 })
  tag?: string;
  @ApiPropertyOptional({ enum: INBOUND_PROTOCOLS })
  protocol?: (typeof INBOUND_PROTOCOLS)[number];
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description:
      'Protocol-specific inbound settings. Must match the existing inbound protocol.',
  })
  settings?: Record<string, unknown>;
}

@ApiTags('admin inbounds')
@ApiBearerAuth()
@Controller('admin/inbounds')
export class InboundsController {
  constructor(private readonly inbounds: InboundsService) {}

  @Get()
  list(@ZodQuery(inboundListQuerySchema) query: InboundListQuery) {
    return this.inbounds.list(query);
  }

  @Post()
  @ApiOperation({
    summary: 'Create an inbound',
    description:
      'Create HYSTERIA2, VLESS_REALITY, TROJAN, or SHADOWSOCKS inbounds using protocol-specific settings.',
  })
  @ApiBody({ type: CreateInboundDto })
  create(
    @Body(InboundCreateValidationPipe) input: CreateInbound,
    @CurrentAdmin() actor: AuthenticatedAdmin,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.inbounds.create(input, actor, getRequestMetadata(request));
  }

  @Get(':id')
  get(@ZodParam('id', idSchema) id: string) {
    return this.inbounds.get(id);
  }

  @Patch(':id')
  @ApiBody({ type: UpdateInboundDto })
  update(
    @ZodParam('id', idSchema) id: string,
    @Body(InboundUpdateValidationPipe) input: UpdateInbound,
    @CurrentAdmin() actor: AuthenticatedAdmin,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.inbounds.update(id, input, actor, getRequestMetadata(request));
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  enable(
    @ZodParam('id', idSchema) id: string,
    @CurrentAdmin() actor: AuthenticatedAdmin,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.inbounds.setEnabled(
      id,
      true,
      actor,
      getRequestMetadata(request),
    );
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  disable(
    @ZodParam('id', idSchema) id: string,
    @CurrentAdmin() actor: AuthenticatedAdmin,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.inbounds.setEnabled(
      id,
      false,
      actor,
      getRequestMetadata(request),
    );
  }

  @Roles('OWNER')
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Destructively delete an inbound' })
  remove(
    @ZodParam('id', idSchema) id: string,
    @CurrentAdmin() actor: AuthenticatedAdmin,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.inbounds.remove(id, actor, getRequestMetadata(request));
  }

  @Get(':id/assignments')
  assignments(
    @ZodParam('id', idSchema) id: string,
    @ZodQuery(assignmentListQuerySchema) query: AssignmentListQuery,
  ) {
    return this.inbounds.listAssignments(id, query);
  }

  @Post(':id/assignments')
  addAssignment(
    @ZodParam('id', idSchema) id: string,
    @ZodBody(addAssignmentSchema) input: AddAssignment,
    @CurrentAdmin() actor: AuthenticatedAdmin,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.inbounds.addAssignment(
      id,
      input,
      actor,
      getRequestMetadata(request),
    );
  }

  @Delete(':id/assignments/:assignmentId')
  @HttpCode(HttpStatus.OK)
  removeAssignment(
    @ZodParam('id', idSchema) id: string,
    @ZodParam('assignmentId', idSchema) assignmentId: string,
    @CurrentAdmin() actor: AuthenticatedAdmin,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.inbounds.removeAssignment(
      id,
      assignmentId,
      actor,
      getRequestMetadata(request),
    );
  }

  @Roles('OWNER', 'ADMIN')
  @Post(':id/assignments/:assignmentId/rotate')
  @HttpCode(HttpStatus.OK)
  rotateCredential(
    @ZodParam('id', idSchema) id: string,
    @ZodParam('assignmentId', idSchema) assignmentId: string,
    @ZodBody(rotateAssignmentCredentialSchema)
    input: RotateAssignmentCredential,
    @CurrentAdmin() actor: AuthenticatedAdmin,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.inbounds.rotateCredential(
      id,
      assignmentId,
      input,
      actor,
      getRequestMetadata(request),
    );
  }

  @Roles('OWNER', 'ADMIN')
  @Get(':id/assignments/:assignmentId/link')
  @Header('Cache-Control', 'no-store')
  link(
    @ZodParam('id', idSchema) id: string,
    @ZodParam('assignmentId', idSchema) assignmentId: string,
    @CurrentAdmin() actor: AuthenticatedAdmin,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.inbounds.link(
      id,
      assignmentId,
      actor,
      getRequestMetadata(request),
    );
  }
}
