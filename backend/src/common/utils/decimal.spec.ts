import { money, rate } from './decimal'

describe('money', () => {
  it('rounds half a cent up, as on paper', () => {
    expect(money(0.145)).toBe(0.15)
    expect(money(1.005)).toBe(1.01)
    expect(money(2.675)).toBe(2.68)
    expect(money(3 * 0.335)).toBe(1.01)
  })

  it('rounds a credit away from zero and keeps whole figures', () => {
    expect(money(-1.005)).toBe(-1.01)
    expect(money(12)).toBe(12)
    expect(money(0)).toBe(0)
    expect(Object.is(money(-0.001), 0)).toBe(true)
  })

  it('agrees with the cents of every quantity times a price of three decimals', () => {
    const wrong: string[] = []
    for (let q = 1; q <= 20; q++) {
      for (let c = 1; c <= 2000; c++) {
        const thousandths = q * c
        const cents = Math.floor(thousandths / 10) + (thousandths % 10 >= 5 ? 1 : 0)
        if (money(q * (c / 1000)) !== cents / 100) wrong.push(`${q} x ${c / 1000}`)
      }
    }
    expect(wrong).toEqual([])
  })
})

describe('rate', () => {
  it('rounds the fourth decimal half up', () => {
    expect(rate(1.00005)).toBe(1.0001)
    expect(rate(0.00125)).toBe(0.0013)
    expect(rate(9.5)).toBe(9.5)
  })
})
