/** Monthly K ranges adapt to the observed sample; unknown salaries never enter a bucket. */
export function salaryDistribution(values: number[]) {
  const salaries = values.filter(v => Number.isFinite(v) && v > 0).sort((a,b) => a-b)
  if (!salaries.length) return []
  const median = (salaries[Math.floor((salaries.length-1)/2)] + salaries[Math.floor(salaries.length/2)]) / 2
  const step = median <= 6 ? 2 : median <= 15 ? 5 : median <= 30 ? 10 : 20
  return Array.from({length:5}, (_,i) => {
    const min = i * step, max = i < 4 ? (i+1)*step : Infinity
    return { name: i === 0 ? `${max}K 以下` : i === 4 ? `${min}K 及以上` : `${min}–${max}K`, min, max,
      count: salaries.filter(v => v >= min && v < max).length }
  })
}
