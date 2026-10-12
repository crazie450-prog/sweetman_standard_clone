import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { notFoundOr } from '../../common/utils/missing'
import { requireTenant } from '../../tenancy/tenant-context'
import type { CategoryKind } from '../../generated/prisma/client'
import { nameLock, named, refuseTaken } from '../../rules/names'
import { serialized, type Serial } from '../../common/utils/serialize'
import { CreateCategoryDto, RenameCategoryDto } from './dto/categories.dto'

export const KINDS = ['ingredient', 'recipe', 'menu'] as const

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(kind?: CategoryKind) {
    const rows = await this.prisma.client.category.findMany({
      where: kind ? { kind } : undefined,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        kind: true,
        _count: { select: { ingredients: true, recipes: true, menuItems: true } },
      },
    })
    return rows.map(({ _count, ...c }) => ({
      ...c,
      used: _count.ingredients + _count.recipes + _count.menuItems,
    }))
  }

  private async assertNameFree(
    name: string,
    kind: CategoryKind,
    except: string | undefined,
    db: Pick<Serial, 'category'>,
  ) {
    const taken = await db.category.findFirst({
      where: { kind, ...named(name, except) },
      select: { name: true },
    })
    if (taken) refuseTaken(`${kind} category`, taken.name)
  }

  async create(dto: CreateCategoryDto) {
    const ctx = requireTenant()
    const kind = dto.kind ?? 'ingredient'
    return serialized(
      this.prisma.client,
      nameLock(`category:${kind}`, ctx.organizationId, dto.name),
      async (tx) => {
        await this.assertNameFree(dto.name, kind, undefined, tx)
        return tx.category.create({
          data: { name: dto.name, kind, organizationId: ctx.organizationId },
          select: { id: true, name: true, kind: true },
        })
      },
    )
  }

  async rename(id: string, dto: RenameCategoryDto) {
    const found = await this.prisma.client.category.findUnique({
      where: { id },
      select: { kind: true },
    })
    if (!found)
      throw new NotFoundException({ code: 'CATEGORY_NOT_FOUND', message: 'Category not found' })
    const lock = nameLock(`category:${found.kind}`, requireTenant().organizationId, dto.name)
    return serialized(this.prisma.client, lock, async (tx) => {
      await this.assertNameFree(dto.name, found.kind, id, tx)
      return tx.category.update({
        where: { id },
        data: { name: dto.name },
        select: { id: true, name: true, kind: true },
      })
    })
  }

  async remove(id: string) {
    try {
      await this.prisma.client.category.delete({ where: { id } })
    } catch (e) {
      throw notFoundOr(e, 'Category not found')
    }
    return { ok: true }
  }
}
