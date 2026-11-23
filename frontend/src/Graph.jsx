import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Button, Group } from '@mantine/core'
import { mutate as refresh } from 'swr'
import { api, img } from './api'

const W = 150, H = 160, PAD = 40
const DAY = 200, LANE = 190 // px per day (down), px per branch (across)

const day = (d) => (d ? Date.parse(d + 'T00:00:00Z') / 864e5 : NaN)

// Timeline tree: y = the drawing's date (top → bottom), x = its branch. A drawing's longest child continues in the
// same column, other children start a new column to the right, so the longest run of work is a straight line on the left.
// Lines only run through the gaps between days and down empty columns, never through a drawing.
function treeLayout(images, admin) {
  const by = new Map(images.map((i) => [i.id, i]))
  const kids = new Map(), parent = new Map()
  images.forEach((i) => {
    const p = i.parents.filter((x) => by.has(x)).sort((a, b) => day(by.get(a).date) - day(by.get(b).date))[0]
    if (p == null) return
    parent.set(i.id, p)
    kids.set(p, [...(kids.get(p) || []), i.id])
  })
  const depth = new Map()
  const deep = (id) => depth.get(id) ?? (depth.set(id, 0), depth.set(id, 1 + Math.max(0, ...(kids.get(id) || []).map(deep))), depth.get(id))
  const days = images.map((i) => day(i.date)).filter(Number.isFinite)
  const t0 = days.length ? Math.min(...days) : 0
  const pos = new Map(), laneEnd = []
  let lanes = 0
  const place = (id, lane, minY) => {
    const d = day(by.get(id).date)
    const y = Math.max(Number.isFinite(d) ? (d - t0) * DAY : minY, minY, (laneEnd[lane] ?? -Infinity) + DAY)
    laneEnd[lane] = y
    pos.set(id, { x: PAD + lane * LANE, y: PAD + y })
    const ch = (kids.get(id) || []).sort((a, b) => deep(b) - deep(a) || day(by.get(a).date) - day(by.get(b).date))
    ch.forEach((c, n) => place(c, n === 0 ? lane : lanes++, y + DAY))
  }
  // trees first; drawings with no links at all only show for the admin, in columns on the right
  images.filter((i) => !parent.has(i.id) && (admin || kids.has(i.id)))
    .sort((a, b) => !kids.has(a.id) - !kids.has(b.id) || deep(b.id) - deep(a.id) || day(a.date) - day(b.date))
    .forEach((r) => place(r.id, lanes++, 0))

  const nodes = images.filter((i) => pos.has(i.id)).map((i) => ({ i, ...pos.get(i.id), tip: parent.has(i.id) && !kids.has(i.id) }))
  const edges = images.flatMap((i) => i.parents.filter((p) => pos.has(p) && pos.has(i.id)).map((p) => {
    const a = pos.get(p), b = pos.get(i.id), sx = a.x + W / 2, sy = a.y + H, tx = b.x + W / 2
    return { p, c: i.id, d: sx === tx ? `M${sx} ${sy}V${b.y}` : `M${sx} ${sy}V${sy + 20}H${tx}V${b.y}` }
  }))
  const height = Math.max(0, ...nodes.map((n) => n.y)) + H + PAD
  return { nodes, edges, width: PAD * 2 + Math.max(0, lanes - 1) * LANE + W, height }
}

// A plain scrolling page: native scroll bar, wheel, touch and keys (↑/↓, PageUp/PageDown, Home/End).
export default function Graph({ me, images }) {
  const admin = !!me.is_admin
  const box = useRef(null)
  const [zoom, setZoom] = useState(null) // null until first fitted to the screen width
  const [connect, setConnect] = useState(false)
  const [from, setFrom] = useState(null)
  const g = useMemo(() => images && treeLayout(images, admin), [images, admin])
  const save = (p) => p.then(() => refresh('/images'))

  const fit = (all) => {
    const el = box.current
    if (el && g) setZoom(Math.min(1, (el.clientWidth - 16) / g.width, all ? el.clientHeight / g.height : 1))
  }
  useLayoutEffect(() => { if (g && zoom == null) fit(false) }, [g, zoom])
  useEffect(() => box.current?.focus({ preventScroll: true }), [g]) // so the keys scroll right away
  const scroll = (top) => box.current?.scrollTo({ top, behavior: 'smooth' })

  const rename = (i) => {
    const name = prompt('Branch label (starts at this drawing; empty removes it)', i.branch || '')
    if (name != null && name.trim() !== (i.branch || '')) save(api(`/images/${i.id}/branch`, 'PUT', { name }))
  }
  // connect mode: click the earlier drawing, then the one that comes after it
  const pick = (id) => {
    if (from == null) return setFrom(id)
    if (from !== id) save(api('/edges', 'POST', { parent: from, child: id }))
    setFrom(null)
  }
  const unlink = (e) => confirm('Remove this connection?') && save(api(`/edges/${e.p}/${e.c}`, 'DELETE'))

  if (!g) return null
  return (
    <div className="graph">
      <div ref={box} className="gscroll" tabIndex={-1}>
        <div className="gcanvas" style={{ width: g.width, height: g.height, zoom: zoom ?? 1 }}>
          <svg width={g.width} height={g.height}>
            <defs>
              <marker id="garrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0 0L10 5L0 10z" fill="currentColor" />
              </marker>
            </defs>
            {g.edges.map((e) => (
              <g key={`${e.p}-${e.c}`} className={admin && !connect ? 'gedit' : ''} onClick={admin && !connect ? () => unlink(e) : undefined}>
                <path d={e.d} className="gedge" markerEnd="url(#garrow)" />
                {admin && !connect && <path d={e.d} className="ghit"><title>Remove connection</title></path>}
              </g>
            ))}
          </svg>
          {g.nodes.map(({ i, x, y, tip }) => (
            <Link key={i.id} to={`/i/${i.id}`} style={{ left: x, top: y }}
              className={'gnode' + (tip ? ' tip' : '') + (from === i.id ? ' from' : '')}
              onClick={connect ? (e) => { e.preventDefault(); pick(i.id) } : undefined}
              onContextMenu={admin ? (e) => { e.preventDefault(); rename(i) } : undefined}>
              <img src={img(i.thumb)} alt="" loading="lazy" draggable={false} />
              {i.branch && <span className="gbranch">{i.branch}</span>}
              <span className="gtitle">{i.title}</span>
            </Link>
          ))}
        </div>
      </div>
      <Group className="gtools" gap="xs">
        <Button size="xs" variant="default" onClick={() => scroll(0)}>↑ Start</Button>
        <Button size="xs" variant="default" onClick={() => scroll(box.current.scrollHeight)}>↓ End</Button>
        <Button size="xs" variant="default" onClick={() => fit(true)}>Fit all</Button>
        <Button size="xs" variant="default" onClick={() => fit(false)}>Fit width</Button>
        {admin && <Button size="xs" variant={connect ? 'filled' : 'default'} onClick={() => { setConnect((c) => !c); setFrom(null) }}
          title="Click a drawing, then the one that comes after it. Right-click a drawing to label its branch.">
          {connect ? (from == null ? 'Pick first…' : 'Pick next…') : 'Connect'}
        </Button>}
      </Group>
    </div>
  )
}
