/** Bounded work changes; a one-card budget must be able to recover when the
 * expensive visibility preparation finishes. Fractional scaling can stick at 1. */
export function nextHouseTileBudget(current: number, milliseconds: number, targetMs = 3) {
  if (!(milliseconds > 0) || !Number.isFinite(milliseconds)) return current
  const wanted = Math.max(1, Math.min(128, Math.floor(current * targetMs / milliseconds)))
  const step = Math.max(1, Math.floor(current * .25))
  return current + Math.sign(wanted - current) * Math.min(step, Math.abs(wanted - current))
}

/** Spend most work on nearby room-sized receivers from the first frame, reserving
 * every fourth slot for the oldest surface anywhere in the house. Small remote
 * fittings must not delay a visible wall's next bounce by an entire house sweep. */
export function selectHouseTiles(cards: { centre: number[]; area: number }[], updated: number[], now: number,
  camera: number[], budget: number, cursor: number, inView?: boolean[]) {
  const ranked = cards.map((card, id) => {
    const distance2 = card.centre.reduce((sum, v, axis) => sum + (v - camera[axis]) ** 2, 0)
    const age = Math.max(1, now - updated[id]),height=card.centre[1]-camera[1]
    // Cap area, not just the final weight: a huge roof or ground plane must not
    // outrank the current room simply because its bounding rectangle is large.
    const importance=Math.min(card.area,12)/((1+distance2)*(1+height*height))
    const visible=inView?.[id]??true
    const nearby=(distance2<100&&Math.abs(height)<3)||(inView?.[id]===true&&distance2<900)
    // Nearby room surfaces feed indirect light into the view even when a wall
    // or doorway hides them. Global maintenance alone can take minutes to
    // revisit these dependencies in a furnished house, leaving halls black.
    // Keep small hidden fittings on the global sweep and reserve the initial
    // bootstrap for visible surfaces so a distant visible model still appears.
    // A room-sized ceiling can have its centre far from the camera even while
    // filling half the screen. Give visible broad receivers a refinement floor;
    // centre distance must not let small fittings monopolise their updates.
    const broadVisible=visible&&nearby&&card.area>=4
    const viewWeight=visible?(broadVisible?3:1):nearby&&card.area>=.5?.35:0
    // Complete the visible first pass before spending local slots refining it.
    // Otherwise old, high-priority walls can keep small fittings black.
    const bootstrap=updated[id]<0&&nearby&&visible?1e9/(1+distance2*.1):0
    return { id, age, priority: bootstrap+age*viewWeight*Math.max(broadVisible?.25:nearby?.04:.0001,Math.min(1,importance)) }
  })
  const oldest = [...ranked].sort((a, b) => b.age - a.age)
  ranked.sort((a, b) => b.priority - a.priority)
  const selected = new Set<number>()
  let local = 0, global = 0
  for (let slot = 0; slot < Math.min(budget, cards.length); slot++) {
    if ((cursor + slot) % 4 === 0) {
      while (selected.has(oldest[global].id)) global++
      selected.add(oldest[global++].id)
    } else {
      while (selected.has(ranked[local].id)) local++
      selected.add(ranked[local++].id)
    }
  }
  return [...selected]
}
