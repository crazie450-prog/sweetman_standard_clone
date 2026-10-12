import { analytics } from './menus.service'

const dish = (cost: number) =>
  ({ active: true, recipes: [{}], price: 100, cost }) as unknown as Parameters<
    typeof analytics
  >[0][number]

describe('menu analytics', () => {
  test('a dish is over the target only when the share it shows is', () => {
    expect(analytics([dish(30.04)], 30).overTarget).toBe(0)
    expect(analytics([dish(30.06)], 30).overTarget).toBe(1)
  })
})
