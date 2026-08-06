import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common'
import {
  ApiCookieAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
  PartialType,
} from '@nestjs/swagger'
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'
import { PrismaService } from '../../prisma/prisma.service'
import { requireTenant } from '../../tenancy/tenant-context'
import { Roles } from '../../common/decorators/roles.decorator'

export class CreateLocationDto {
  @ApiProperty({ example: 'Golden Fork — Downtown' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string
}
export class UpdateLocationDto extends PartialType(CreateLocationDto) {
  @ApiPropertyOptional({ description: 'false = archive, true = restore to active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean
}

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  async listForCurrentUser() {
    const ctx = requireTenant()
    const access = await this.prisma.client.userLocation.findMany({
      where: { userId: ctx.userId },
      select: { locationId: true },
    })
    const ids = access.map((a) => a.locationId)
    return this.prisma.client.location.findMany({
      where: { isActive: true, ...(ids.length > 0 ? { id: { in: ids } } : {}) },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })
  }

  listAll() {
    return this.prisma.client.location.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        address: true,
        phone: true,
        isActive: true,
        isDefault: true,
      },
    })
  }

  create(dto: CreateLocationDto) {
    const ctx = requireTenant()
    return this.prisma.client.location.create({
      data: { ...dto, organizationId: ctx.organizationId },
      select: { id: true, name: true },
    })
  }

  async update(id: string, dto: UpdateLocationDto) {
    try {
      return await this.prisma.client.location.update({
        where: { id },
        data: dto,
        select: { id: true, name: true, address: true, phone: true, isActive: true },
      })
    } catch {
      throw new NotFoundException('Location not found')
    }
  }

  async deactivate(id: string) {
    try {
      await this.prisma.client.location.update({ where: { id }, data: { isActive: false } })
    } catch {
      throw new NotFoundException('Location not found')
    }
    return { ok: true }
  }
}

@ApiTags('locations')
@ApiCookieAuth()
@Controller('api')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get('properties')
  @ApiOperation({ summary: 'Location switcher feed ({id,name}[])' })
  forSwitcher() {
    return this.locations.listForCurrentUser()
  }

  @Get('locations')
  @Roles('manager')
  @ApiOperation({ summary: 'All organization locations (management view)' })
  listAll() {
    return this.locations.listAll()
  }

  @Post('locations')
  @Roles('admin')
  @ApiOperation({ summary: 'Create a restaurant location' })
  create(@Body() dto: CreateLocationDto) {
    return this.locations.create(dto)
  }

  @Patch('locations/:id')
  @Roles('admin')
  @ApiOperation({ summary: 'Update a location, or restore it from the archive with isActive' })
  update(@Param('id') id: string, @Body() dto: UpdateLocationDto) {
    return this.locations.update(id, dto)
  }

  @Delete('locations/:id')
  @Roles('admin')
  @ApiOperation({ summary: 'Archive a location; its data stays and it can be restored' })
  deactivate(@Param('id') id: string) {
    return this.locations.deactivate(id)
  }
}

@Module({
  providers: [LocationsService],
  controllers: [LocationsController],
})
export class LocationsModule {}
