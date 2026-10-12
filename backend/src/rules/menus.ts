import { BadRequestException } from '@nestjs/common'

export interface ServedDish {
  name: string
  locationId: string | null
}

export interface ServingMenu {
  name: string
  locationIds: string[]
}

export function servedBy(dish: ServedDish, menu: ServingMenu): boolean {
  return (
    dish.locationId === null ||
    menu.locationIds.length === 0 ||
    menu.locationIds.includes(dish.locationId)
  )
}

export function assertServedBy(dish: ServedDish, menu: ServingMenu): void {
  if (servedBy(dish, menu)) return
  throw new BadRequestException({
    code: 'DISH_NOT_ON_MENU_THERE',
    message: `${dish.name} is sold at a location that does not serve ${menu.name}; add it to a menu of its own location, or make the dish available at every location`,
  })
}
