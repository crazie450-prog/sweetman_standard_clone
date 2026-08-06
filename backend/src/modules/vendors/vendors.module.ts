import { Module } from '@nestjs/common'
import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common'
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'
import { PrismaService } from '../../prisma/prisma.service'
import { requireTenant } from '../../tenancy/tenant-context'
import { Roles } from '../../common/decorators/roles.decorator'

// ---------------------------------------------------------------------- DTO
export class CreateVendorDto {
  @ApiProperty({ example: 'Prime Meats Co.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string

  @ApiPropertyOptional({ example: 'orders@primemeats.com' })
  @IsOptional()
  @IsEmail()
  contact?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string

  @ApiPropertyOptional({ enum: ['active', 'inactive'] })
  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive'

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string
}
export class UpdateVendorDto extends PartialType(CreateVendorDto) {}

function toContract(v: {
  id: string
  name: string
  contact: string | null
  phone: string | null
  notes: string | null
  status: string
  _count: { ingredients: number }
  invoices?: { invoiceDate: Date }[]
}) {
  return {
    id: v.id,
    name: v.name,
    contact: v.contact ?? '',
    phone: v.phone ?? '',
    notes: v.notes ?? '',
    products: v._count.ingredients,
    lastInvoice: v.invoices?.[0]?.invoiceDate.toISOString().slice(0, 10) ?? null,
    status: v.status,
  }
}

// ------------------------------------------------------------------ Service
@Injectable()
export class VendorsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const vendors = await this.prisma.client.vendor.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { ingredients: true } },
        invoices: { orderBy: { invoiceDate: 'desc' }, take: 1, select: { invoiceDate: true } },
      },
    })
    return vendors.map(toContract)
  }

  async create(dto: CreateVendorDto) {
    const ctx = requireTenant()
    const created = await this.prisma.client.vendor.create({
      data: { ...dto, organizationId: ctx.organizationId },
      include: {
        _count: { select: { ingredients: true } },
        invoices: { orderBy: { invoiceDate: 'desc' }, take: 1, select: { invoiceDate: true } },
      },
    })
    return toContract(created)
  }

  async update(id: string, dto: UpdateVendorDto) {
    try {
      const updated = await this.prisma.client.vendor.update({
        where: { id },
        data: dto,
        include: {
        _count: { select: { ingredients: true } },
        invoices: { orderBy: { invoiceDate: 'desc' }, take: 1, select: { invoiceDate: true } },
      },
      })
      return toContract(updated)
    } catch {
      throw new NotFoundException('Vendor not found')
    }
  }

  async remove(id: string) {
    try {
      await this.prisma.client.vendor.delete({ where: { id } })
    } catch {
      throw new NotFoundException('Vendor not found')
    }
    return { ok: true }
  }
}

// --------------------------------------------------------------- Controller
@ApiTags('vendors')
@ApiCookieAuth()
@Controller('api/vendors')
export class VendorsController {
  constructor(private readonly vendors: VendorsService) {}

  @Get()
  @ApiOperation({ summary: 'Organization vendors' })
  list() {
    return this.vendors.list()
  }

  @Post()
  @Roles('manager')
  @ApiOperation({ summary: 'Create a vendor' })
  create(@Body() dto: CreateVendorDto) {
    return this.vendors.create(dto)
  }

  @Patch(':id')
  @Roles('manager')
  @ApiOperation({ summary: 'Update a vendor' })
  update(@Param('id') id: string, @Body() dto: UpdateVendorDto) {
    return this.vendors.update(id, dto)
  }

  @Delete(':id')
  @Roles('manager')
  @ApiOperation({ summary: 'Delete a vendor; its ingredients stay and lose the link' })
  remove(@Param('id') id: string) {
    return this.vendors.remove(id)
  }
}

@Module({
  providers: [VendorsService],
  controllers: [VendorsController],
})
export class VendorsModule {}
