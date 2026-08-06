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
import { Type } from 'class-transformer'
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import { PrismaService } from '../../prisma/prisma.service'
import { requireLocation, requireTenant } from '../../tenancy/tenant-context'
import { Roles } from '../../common/decorators/roles.decorator'
import { money, num } from '../../common/utils/decimal'
import type { Prisma } from '../../generated/prisma/client'

// ---------------------------------------------------------------------- DTO
export class InvoiceItemInput {
  @ApiPropertyOptional({ description: 'Links the line to a known ingredient' })
  @IsOptional()
  @IsString()
  ingredientId?: string

  @ApiProperty({ description: 'Product name as it appears on the invoice' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  description!: string

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  quantity!: number

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  unit!: string

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice!: number
}

export class CreateInvoiceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vendorId?: string

  @ApiPropertyOptional({ description: 'Invoice number as printed by the vendor' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  number?: string

  @ApiProperty({ description: 'ISO date' })
  @IsISO8601()
  invoiceDate!: string

  @ApiPropertyOptional({ description: 'ISO date' })
  @IsOptional()
  @IsISO8601()
  dueDate?: string

  @ApiPropertyOptional({ enum: ['draft', 'confirmed'] })
  @IsOptional()
  @IsIn(['draft', 'confirmed'])
  status?: 'draft' | 'confirmed'

  @ApiPropertyOptional({ description: 'Tax amount; the subtotal is summed from the lines' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  tax?: number

  @ApiPropertyOptional({ description: 'Storage key of the uploaded document' })
  @IsOptional()
  @IsString()
  documentKey?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string

  @ApiProperty({ type: [InvoiceItemInput] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemInput)
  items!: InvoiceItemInput[]
}

export class UpdateInvoiceDto extends PartialType(CreateInvoiceDto) {}

type InvoiceRow = Prisma.InvoiceGetPayload<{
  include: {
    vendor: { select: { name: true } }
    items: { include: { ingredient: { select: { name: true } } } }
  }
}>

function toContract(i: InvoiceRow) {
  return {
    id: i.id,
    number: i.number ?? '',
    vendorId: i.vendorId,
    vendor: i.vendor?.name ?? '',
    locationId: i.locationId,
    invoiceDate: i.invoiceDate.toISOString().slice(0, 10),
    dueDate: i.dueDate ? i.dueDate.toISOString().slice(0, 10) : null,
    status: i.status,
    subtotal: num(i.subtotal),
    tax: num(i.tax),
    total: num(i.total),
    documentKey: i.documentKey,
    notes: i.notes ?? '',
    items: i.items.map((line) => ({
      id: line.id,
      ingredientId: line.ingredientId,
      ingredient: line.ingredient?.name ?? '',
      description: line.description,
      quantity: num(line.quantity),
      unit: line.unit,
      unitPrice: num(line.unitPrice),
      lineTotal: num(line.lineTotal),
    })),
  }
}

const INVOICE_INCLUDE = {
  vendor: { select: { name: true } },
  items: { include: { ingredient: { select: { name: true } } } },
} as const

const lineTotals = (items: InvoiceItemInput[]) =>
  items.map((line) => ({ ...line, lineTotal: money(line.quantity * line.unitPrice) }))

// ------------------------------------------------------------------ Service
@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const rows = await this.prisma.client.invoice.findMany({
      orderBy: { invoiceDate: 'desc' },
      include: INVOICE_INCLUDE,
    })
    return rows.map(toContract)
  }

  async get(id: string) {
    const row = await this.prisma.client.invoice.findUnique({
      where: { id },
      include: INVOICE_INCLUDE,
    })
    if (!row) throw new NotFoundException('Invoice not found')
    return toContract(row)
  }

  async create(dto: CreateInvoiceDto) {
    const ctx = requireTenant()
    const locationId = requireLocation()
    const lines = lineTotals(dto.items)
    const subtotal = money(lines.reduce((sum, line) => sum + line.lineTotal, 0))
    const tax = dto.tax ?? 0

    const created = await this.prisma.client.invoice.create({
      data: {
        organizationId: ctx.organizationId,
        locationId,
        vendorId: dto.vendorId,
        number: dto.number,
        invoiceDate: new Date(dto.invoiceDate),
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        status: dto.status ?? 'draft',
        subtotal,
        tax,
        total: money(subtotal + tax),
        documentKey: dto.documentKey,
        notes: dto.notes,
        items: { create: lines },
      },
      include: INVOICE_INCLUDE,
    })
    return toContract(created)
  }

  async update(id: string, dto: UpdateInvoiceDto) {
    const current = await this.prisma.client.invoice.findUnique({ where: { id } })
    if (!current) throw new NotFoundException('Invoice not found')

    const lines = dto.items ? lineTotals(dto.items) : null
    const subtotal = lines
      ? money(lines.reduce((sum, line) => sum + line.lineTotal, 0))
      : num(current.subtotal)
    const tax = dto.tax ?? num(current.tax)

    const updated = await this.prisma.client.invoice.update({
      where: { id },
      data: {
        ...(dto.vendorId === undefined ? {} : { vendorId: dto.vendorId }),
        ...(dto.number === undefined ? {} : { number: dto.number }),
        ...(dto.invoiceDate === undefined ? {} : { invoiceDate: new Date(dto.invoiceDate) }),
        ...(dto.dueDate === undefined ? {} : { dueDate: new Date(dto.dueDate) }),
        ...(dto.status === undefined ? {} : { status: dto.status }),
        ...(dto.documentKey === undefined ? {} : { documentKey: dto.documentKey }),
        ...(dto.notes === undefined ? {} : { notes: dto.notes }),
        subtotal,
        tax,
        total: money(subtotal + tax),
        ...(lines ? { items: { deleteMany: {}, create: lines } } : {}),
      },
      include: INVOICE_INCLUDE,
    })
    return toContract(updated)
  }

  async remove(id: string) {
    try {
      await this.prisma.client.invoice.delete({ where: { id } })
    } catch {
      throw new NotFoundException('Invoice not found')
    }
    return { ok: true }
  }
}

// --------------------------------------------------------------- Controller
@ApiTags('invoices')
@ApiCookieAuth()
@Controller('api/invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @ApiOperation({ summary: 'Vendor invoices, newest first' })
  list() {
    return this.invoices.list()
  }

  @Get(':id')
  @ApiOperation({ summary: 'One invoice with its line items' })
  get(@Param('id') id: string) {
    return this.invoices.get(id)
  }

  @Post()
  @Roles('staff')
  @ApiOperation({
    summary: 'Record an invoice; extraction from an uploaded document lands in Sprint 3',
  })
  create(@Body() dto: CreateInvoiceDto) {
    return this.invoices.create(dto)
  }

  @Patch(':id')
  @Roles('staff')
  @ApiOperation({ summary: 'Update an invoice; sending items replaces every line' })
  update(@Param('id') id: string, @Body() dto: UpdateInvoiceDto) {
    return this.invoices.update(id, dto)
  }

  @Delete(':id')
  @Roles('manager')
  @ApiOperation({ summary: 'Delete an invoice and its line items' })
  remove(@Param('id') id: string) {
    return this.invoices.remove(id)
  }
}

@Module({
  controllers: [InvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
