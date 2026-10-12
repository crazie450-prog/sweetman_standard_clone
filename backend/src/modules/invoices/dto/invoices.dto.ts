import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { PageQuery } from '../../../common/dto/pagination.dto'
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator'
import { Money, Quantity, Rate } from '../../../common/validation/numeric'

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
  @Quantity()
  quantity!: number

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  unit!: string

  @ApiProperty()
  @Rate()
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
  @IsISO8601({ strict: true })
  invoiceDate!: string

  @ApiPropertyOptional({ description: 'ISO date' })
  @IsOptional()
  @IsISO8601({ strict: true })
  dueDate?: string

  @ApiPropertyOptional({ enum: ['draft', 'confirmed'] })
  @IsOptional()
  @IsIn(['draft', 'confirmed'])
  status?: 'draft' | 'confirmed'

  @ApiPropertyOptional({ description: 'Tax amount; the subtotal is summed from the lines' })
  @IsOptional()
  @Money()
  tax?: number

  @ApiPropertyOptional({ description: 'Storage key of the uploaded document' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
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

export class UpdateInvoiceDto extends PartialType(CreateInvoiceDto, {
  skipNullProperties: false,
}) {}

export class InvoicesQuery extends PageQuery {
  @ApiPropertyOptional({ description: 'Only the invoices of this vendor' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  vendorId?: string
}
