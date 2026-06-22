import { describe, it, expect } from 'vitest'
import { mapHotSlotRows } from '../nawode-data'

// Чистый маппер сырых SQL-строк → HotSlot[] (map + filter + sort). SQL не мокаем — тестируем логику.
const row = (over: Record<string, any> = {}) => ({
  date: '2026-06-25', start_time: '18:00', tour_name: 'Тур', service_type: 'TOUR',
  bookings_cnt: 2, people: 3, capacity: 9, ...over,
})

describe('mapHotSlotRows', () => {
  it('считает remaining и оставляет слоты, где есть места', () => {
    const out = mapHotSlotRows([row({ people: 3, capacity: 9 })])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ peopleBooked: 3, capacity: 9, remaining: 6, serviceType: 'TOUR' })
  })

  it('выкидывает заполненные слоты (people >= capacity)', () => {
    expect(mapHotSlotRows([row({ people: 9, capacity: 9 })])).toHaveLength(0)
    expect(mapHotSlotRows([row({ people: 12, capacity: 9 })])).toHaveLength(0)
  })

  it('оставляет слоты с НЕИЗВЕСТНОЙ вместимостью (social-proof), remaining = null', () => {
    const out = mapHotSlotRows([row({ tour_name: null, service_type: 'RENTAL', capacity: null, people: 2 })])
    expect(out).toHaveLength(1)
    expect(out[0].remaining).toBeNull()
    expect(out[0].capacity).toBeNull()
  })

  it('исключает слоты без людей', () => {
    expect(mapHotSlotRows([row({ people: 0, bookings_cnt: 0 })])).toHaveLength(0)
  })

  it('сортирует: ближайший день → групповые форматы → почти заполнен', () => {
    const out = mapHotSlotRows([
      row({ date: '2026-06-26', service_type: 'RENTAL', tour_name: 'Прокат', people: 1, capacity: 9 }),
      row({ date: '2026-06-25', service_type: 'RENTAL', tour_name: 'Прокат', start_time: '10:00', people: 2, capacity: 9 }),
      row({ date: '2026-06-25', service_type: 'TOUR', tour_name: 'Тур', start_time: '18:00', people: 6, capacity: 8 }),
    ])
    expect(out.map(s => `${s.date}/${s.serviceType}`)).toEqual([
      '2026-06-25/TOUR',   // ближайший день + групповой формат
      '2026-06-25/RENTAL', // тот же день, но прокат
      '2026-06-26/RENTAL', // следующий день
    ])
  })

  it('в одном дне/формате «почти заполнен» идёт первым', () => {
    const out = mapHotSlotRows([
      row({ start_time: '10:00', people: 2, capacity: 9 }), // remaining 7
      row({ start_time: '14:00', people: 7, capacity: 9 }), // remaining 2 → первым
    ])
    expect(out.map(s => s.startTime)).toEqual(['14:00', '10:00'])
  })

  it('грейсфул на пустом/некорректном входе', () => {
    expect(mapHotSlotRows([])).toEqual([])
    expect(mapHotSlotRows(null as any)).toEqual([])
  })
})
