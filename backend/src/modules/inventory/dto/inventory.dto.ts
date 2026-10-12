import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'
import { PagedPeriodQuery } from '../../../common/dto/period.dto'
import type { TxType } from '../../../generated/prisma/client'
import { MONEY_MAX, Money, QUANTITY_MAX, Quantity } from '../../../common/validation/numeric'

const TX_TYPES = ['RECEIVE', 'USE', 'ADJUST', 'WASTE', 'COUNT'] as const
const RECORDED_HERE = TX_TYPES.filter((type) => type !== 'WASTE')

export const TX_KINDS = ['received', 'used', 'wasted', 'counted'] as const
export type TxKind = (typeof TX_KINDS)[number]

export class TransactionsQuery extends PagedPeriodQuery {
  @ApiPropertyOptional({ enum: TX_KINDS, description: 'Only movements of this kind' })
  @IsOptional()
  @IsIn(TX_KINDS as unknown as string[])
  type?: TxKind
}

export class CreateTransactionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  ingredientId!: string

  @ApiProperty({ enum: RECORDED_HERE, description: 'Waste is recorded through POST /api/waste' })
  @IsIn(TX_TYPES as unknown as string[])
  type!: Exclude<TxType, 'SALE'>

  @ApiProperty({
    description:
      '+ received, - consumed; COUNT states the absolute on-hand value and records the difference',
  })
  @Quantity(-QUANTITY_MAX)
  quantity!: number

  @ApiPropertyOptional({ description: 'Transaction value; empty = qty × costPerUnit' })
  @IsOptional()
  @Money(-MONEY_MAX)
  cost?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string
}
