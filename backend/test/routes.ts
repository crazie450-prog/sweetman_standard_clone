import { INestApplication, RequestMethod } from '@nestjs/common'
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants'
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum'
import { ModulesContainer } from '@nestjs/core'
import { IS_PUBLIC_KEY } from '../src/common/decorators/public.decorator'
import { ROLES_KEY } from '../src/common/decorators/roles.decorator'
import { PlatformAdminGuard } from '../src/common/guards/platform-admin.guard'
import type { Role } from '../src/generated/prisma/client'

export type Route = {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete'
  path: string
  url: string
  role?: Role
  isPublic: boolean
  platformOnly: boolean
  inputs: Input[]
}

export type Input = { source: 'body' | 'query'; key?: string; type: unknown }

const VERBS: Partial<Record<RequestMethod, Route['method']>> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.PATCH]: 'patch',
  [RequestMethod.DELETE]: 'delete',
}

const joined = (...parts: unknown[]) =>
  '/' +
  parts
    .map((p) => (Array.isArray(p) ? p[0] : p))
    .filter((p): p is string => typeof p === 'string' && p !== '' && p !== '/')
    .map((p) => p.replace(/^\/|\/$/g, ''))
    .join('/')

export function routesOf(app: INestApplication): Route[] {
  const routes: Route[] = []
  for (const mod of app.get(ModulesContainer).values()) {
    for (const wrapper of mod.controllers.values()) {
      const cls = wrapper.metatype as (new (...args: never[]) => object) | null
      if (!cls) continue
      const base = Reflect.getMetadata(PATH_METADATA, cls) as unknown
      const classGuards = (Reflect.getMetadata(GUARDS_METADATA, cls) ?? []) as unknown[]
      for (const name of Object.getOwnPropertyNames(cls.prototype)) {
        const handler = (cls.prototype as Record<string, unknown>)[name]
        if (typeof handler !== 'function' || name === 'constructor') continue
        const verb = VERBS[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod]
        const own = Reflect.getMetadata(PATH_METADATA, handler) as unknown
        if (!verb || own === undefined) continue
        const path = joined(base, own)
        const guards = [
          ...classGuards,
          ...((Reflect.getMetadata(GUARDS_METADATA, handler) ?? []) as unknown[]),
        ]
        const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, cls, name) ?? {}) as Record<
          string,
          { index: number; data?: string }
        >
        const types = (Reflect.getMetadata('design:paramtypes', cls.prototype, name) ??
          []) as unknown[]
        const inputs: Input[] = []
        for (const [key, arg] of Object.entries(args)) {
          const kind = Number(key.split(':')[0])
          const source =
            kind === RouteParamtypes.BODY ? 'body' : kind === RouteParamtypes.QUERY ? 'query' : null
          if (source) inputs.push({ source, key: arg.data, type: types[arg.index] })
        }
        routes.push({
          method: verb,
          path,
          url: path.replace(/:\w+/g, 'probe-missing'),
          role: (Reflect.getMetadata(ROLES_KEY, handler) ?? Reflect.getMetadata(ROLES_KEY, cls)) as
            Role | undefined,
          isPublic: Boolean(
            Reflect.getMetadata(IS_PUBLIC_KEY, handler) ?? Reflect.getMetadata(IS_PUBLIC_KEY, cls),
          ),
          platformOnly: guards.includes(PlatformAdminGuard),
          inputs,
        })
      }
    }
  }
  return routes
}

export const label = (r: Route) => `${r.method.toUpperCase()} ${r.path}`
