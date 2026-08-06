import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
} from '@nestjs/common'
import { ApiCookieAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { ArrayUnique, IsArray, IsIn, IsOptional, IsString } from 'class-validator'
import { PrismaService } from '../../prisma/prisma.service'
import { requireTenant } from '../../tenancy/tenant-context'
import { Roles } from '../../common/decorators/roles.decorator'
import { INVITABLE_ROLES } from '../../invitations/invitations.dto'
import type { Role } from '../../generated/prisma/client'

export class UpdateMemberDto {
  @ApiPropertyOptional({ enum: INVITABLE_ROLES })
  @IsOptional()
  @IsIn(INVITABLE_ROLES)
  role?: Role

  @ApiPropertyOptional({ type: [String], description: 'An empty array means every location' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  locationIds?: string[]
}

@Injectable()
export class TeamService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const [users, pending] = await Promise.all([
      this.prisma.client.user.findMany({
        where: { isActive: true },
        orderBy: { createdAt: 'asc' },
        include: {
          locationAccess: { include: { location: { select: { id: true, name: true } } } },
        },
      }),
      this.prisma.client.invitation.findMany({
        where: { status: 'pending' },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    const members = users.map((u) => ({
      id: u.id,
      name: u.fullName,
      email: u.email,
      role: u.role,
      locations: u.locationAccess.map((a) => a.location),
      status: 'active' as const,
    }))
    const invited = pending.map((i) => ({
      id: i.id,
      name: i.email,
      email: i.email,
      role: i.role,
      locations: [] as { id: string; name: string }[],
      status: 'invited' as const,
    }))
    return [...members, ...invited]
  }

  async update(id: string, dto: UpdateMemberDto) {
    const ctx = requireTenant()
    const user = await this.prisma.client.user.findUnique({ where: { id } })
    if (!user) throw new NotFoundException('User not found')
    if (user.role === 'owner') throw new BadRequestException('Owner cannot be modified')
    if (id === ctx.userId) throw new BadRequestException('Cannot modify your own account here')

    if (dto.locationIds) {
      const owned = await this.prisma.client.location.findMany({
        where: { id: { in: dto.locationIds } },
        select: { id: true },
      })
      if (owned.length !== dto.locationIds.length) {
        throw new BadRequestException('Unknown location in locationIds')
      }
    }

    await this.prisma.client.$transaction(async (tx) => {
      if (dto.role) await tx.user.update({ where: { id }, data: { role: dto.role } })
      if (dto.locationIds) {
        await tx.userLocation.deleteMany({ where: { userId: id } })
        if (dto.locationIds.length > 0) {
          await tx.userLocation.createMany({
            data: dto.locationIds.map((locationId) => ({ userId: id, locationId })),
          })
        }
      }
    })
    return { ok: true }
  }

  async deactivate(id: string) {
    const ctx = requireTenant()
    if (id === ctx.userId) throw new BadRequestException('Cannot deactivate yourself')
    const user = await this.prisma.client.user.findUnique({ where: { id } })
    if (!user) throw new NotFoundException('User not found')
    if (user.role === 'owner') throw new BadRequestException('Owner cannot be deactivated')
    await this.prisma.client.user.update({
      where: { id },
      data: { isActive: false },
    })
    await this.prisma.client.userSession.deleteMany({ where: { userId: id } })
    return { ok: true }
  }
}

@ApiTags('team')
@ApiCookieAuth()
@Controller('api/users')
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get()
  @ApiOperation({ summary: 'Team members and pending invitations (locations={id,name}[])' })
  list() {
    return this.team.list()
  }

  @Patch(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Change a member role or their location access' })
  update(@Param('id') id: string, @Body() dto: UpdateMemberDto) {
    return this.team.update(id, dto)
  }

  @Delete(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Deactivate a member; the account stays and can be re-enabled' })
  deactivate(@Param('id') id: string) {
    return this.team.deactivate(id)
  }
}

@Module({
  providers: [TeamService],
  controllers: [TeamController],
})
export class TeamModule {}
