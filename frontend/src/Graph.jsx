import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Button, Group } from '@mantine/core'
import cytoscape from 'cytoscape'
import edgehandles from 'cytoscape-edgehandles'
import { mutate as refresh } from 'swr'
import { api, img } from './api'

cytoscape.use(edgehandles)

const W = 150, H = 160, PAD = 40

const DAY = 200, LANE = 190 // px per day (down), px per branch (across)

const day = (d) => (d ? Date.parse(d + 'T00:00:00Z') / 864e5 : NaN)

// Timeline tree: y = the drawing's date (top → bottom), x = its branch. A drawing's longest child continues in the
// same column, other children start a new column to the right, so the longest run of work is a straight line on the left.
function treeLayout(images, shown) {
  const by = new Map(images.map((i) => [String(i.id), i]))
  const kids = new Map(), parent = new Map()
  images.forEach((i) => {
    const p = i.parents.map(String).filter((x) => by.has(x)).sort((a, b) => day(by.get(a).date) - day(by.get(b).date))[0]
    if (p == null) return
    parent.set(String(i.id), p)
    kids.set(p, [...(kids.get(p) || []), String(i.id)])
  })
  const depth = new Map()
  const deep = (id) => depth.get(id) ?? (depth.set(id, 0), depth.set(id, 1 + Math.max(0, ...(kids.get(id) || []).map(deep))), depth.get(id))
  const days = images.map((i) => day(i.date)).filter(Number.isFinite)
  const t0 = days.length ? Math.min(...days) : 0
  const pos = {}, laneEnd = []
  let lanes = 0
  const place = (id, lane, minY) => {
    const d = day(by.get(id).date)
    const y = Math.max(Number.isFinite(d) ? (d - t0) * DAY : minY, minY, (laneEnd[lane] ?? -Infinity) + DAY)
    laneEnd[lane] = y
    pos[id] = { x: lane * LANE, y }
    const ch = (kids.get(id) || []).sort((a, b) => deep(b) - deep(a) || day(by.get(a).date) - day(by.get(b).date))
    ch.forEach((c, n) => place(c, n === 0 ? lane : lanes++, y + DAY))
  }
  const roots = [...shown].filter((id) => !parent.has(id))
    .sort((a, b) => !kids.has(a) - !kids.has(b) || deep(b) - deep(a) || day(by.get(a).date) - day(by.get(b).date))
  roots.forEach((r) => place(r, lanes++, 0)) // trees first, unlinked drawings (admin only) in columns on the right
  return pos
}

// vertical scroll position of the graph: `at` px scrolled past the top, `max` px it can go
const vscroll = (cy) => {
  const b = cy.nodes().renderedBoundingBox()
  return { at: PAD - b.y1, max: b.h + 2 * PAD - cy.height() }
}
const scrollTo = (cy, s, animate = false) => {
  const { at, max } = vscroll(cy), dy = at - Math.max(0, Math.min(max, s))
  if (animate) cy.stop().animate({ panBy: { x: 0, y: dy }, duration: 300 })
  else cy.panBy({ x: 0, y: dy })
}

const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

const labelAt = (p) => p && { x: p.x, y: p.y - H / 2 + 16 }

const style = () => {
  const dim = css('--mantine-color-dark-4', '#424242'), blue = css('--mantine-color-blue-5', '#339af0')
  const yellow = css('--mantine-color-yellow-5', '#fcc419')
  return [
    { selector: 'node.img', style: {
      shape: 'round-rectangle', width: W, height: H, 'background-color': css('--mantine-color-dark-6', '#2e2e2e'),
      'background-image': 'data(src)', 'background-fit': 'cover', 'background-image-crossorigin': 'null',
      'border-width': 2, 'border-color': dim, label: 'data(title)', color: css('--mantine-color-dark-0', '#c9c9c9'),
      'font-size': 12, 'text-valign': 'bottom', 'text-margin-y': -6, 'text-wrap': 'ellipsis', 'text-max-width': W - 12,
      'text-background-color': '#000', 'text-background-opacity': 0.6, 'text-background-padding': 3, 'text-background-shape': 'round-rectangle',
    } },
    { selector: 'node.tip', style: { 'border-color': yellow, 'underlay-color': yellow, 'underlay-opacity': 0.25, 'underlay-padding': 6, 'underlay-shape': 'round-rectangle' } },
    { selector: 'node.branch', style: {
      shape: 'round-rectangle', width: 'data(w)', height: 22, 'background-color': css('--mantine-color-violet-7', '#6741d9'),
      label: 'data(label)', color: '#fff', 'font-size': 12, 'font-weight': 600, 'text-valign': 'center', 'text-halign': 'center',
      'text-wrap': 'ellipsis', 'text-max-width': W - 24, 'border-width': 0, 'z-index': 10,
    } },
    { selector: 'node.img:selected', style: { 'border-color': blue, 'border-width': 3, 'overlay-color': blue, 'overlay-opacity': 0.15 } },
    { selector: 'edge', style: { width: 2, 'line-color': dim, 'target-arrow-color': dim, 'target-arrow-shape': 'triangle', 'arrow-scale': 0.8, 'curve-style': 'taxi', 'taxi-direction': 'downward', 'taxi-turn': 20, 'taxi-turn-min-distance': 8 } },
    { selector: 'edge:selected', style: { 'line-color': blue, 'target-arrow-color': blue } },
    { selector: '.eh-hover', style: { 'border-color': blue, 'border-width': 3 } },
    { selector: '.eh-preview, .eh-ghost-edge', style: { 'line-color': blue, 'target-arrow-color': blue, 'line-style': 'dashed' } },
    { selector: '.eh-ghost-edge.eh-preview-active', style: { opacity: 0 } },
  ]
}

// drawings → cytoscape elements (admin also sees drawings that aren't linked yet)
function elements(images, admin) {
  const edges = images.flatMap((i) => i.parents.map((p) => ({ group: 'edges', data: { id: `${p}-${i.id}`, source: String(p), target: String(i.id) } })))
  const linked = new Set(edges.flatMap((e) => [e.data.source, e.data.target]))
  const hasChild = new Set(edges.map((e) => e.data.source))
  const nodes = images.filter((i) => admin || linked.has(String(i.id))).map((i) => {
    const id = String(i.id)
    return { group: 'nodes', data: { id, src: img(i.thumb), title: i.title }, classes: linked.has(id) && !hasChild.has(id) ? 'img tip' : 'img' }
  })
  // branch labels: a little pill pinned to the top of the drawing the branch starts at
  const labels = images.filter((i) => i.branch && nodes.some((n) => n.data.id === String(i.id))).map((i) => ({
    group: 'nodes', selectable: false, grabbable: false, classes: 'branch',
    data: { id: `b${i.id}`, owner: String(i.id), label: i.branch, w: Math.min(W - 8, i.branch.length * 7.5 + 20) },
  }))
  return [...nodes, ...labels, ...edges]
}

export default function Graph({ me, images }) {
  const navigate = useNavigate()
  const go = useRef(navigate)
  go.current = navigate
  const track = useRef(null), thumb = useRef(null)
  const box = useRef(null), cyRef = useRef(null), ehRef = useRef(null), shape = useRef(''), target = useRef({})
  const [connect, setConnect] = useState(false)
  const connectRef = useRef(false)
  const admin = !!me.is_admin
  const save = (p) => p.then(() => refresh('/images'))

  // move every drawing to its place in the tree (undoes any manual dragging)
  const arrange = (fit = false) => {
    const cy = cyRef.current
    cy.layout({ name: 'preset', positions: (n) => target.current[n.id()], animate: !fit, animationDuration: 300, fit: false }).run()
    if (fit) fitWidth(false)
  }

  // scroll view: as wide as the screen allows (never bigger than real size), starting at the top
  const fitWidth = (animate = true) => {
    const cy = cyRef.current, b = cy.nodes().boundingBox()
    if (cy.nodes().empty()) return
    const zoom = Math.min(1, (cy.width() - 2 * PAD) / b.w)
    const pan = { x: (cy.width() - b.w * zoom) / 2 - b.x1 * zoom, y: PAD - b.y1 * zoom }
    animate ? cy.animate({ zoom, pan, duration: 300 }) : cy.viewport({ zoom, pan })
  }
  const fitAll = () => cyRef.current?.animate({ fit: { padding: PAD }, duration: 300 })
  const toStart = () => cyRef.current && scrollTo(cyRef.current, 0, true)
  const toEnd = () => cyRef.current && scrollTo(cyRef.current, Infinity, true)

  // keys: ↑/↓ = about a day, PageUp/PageDown = a screen, Home/End = start/end
  useEffect(() => {
    const key = (e) => {
      const cy = cyRef.current, el = e.target
      if (!cy || e.altKey || e.ctrlKey || e.metaKey || el.closest?.('input, textarea, select, [contenteditable="true"]')) return
      const page = cy.height() * 0.85, step = Math.max(60, DAY * cy.zoom()), { at } = vscroll(cy)
      const to = { ArrowUp: at - step, ArrowDown: at + step, PageUp: at - page, PageDown: at + page, Home: 0, End: Infinity }[e.key]
      if (to === undefined) return
      e.preventDefault()
      scrollTo(cy, to, true)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  // scroll bar: drag the thumb, or click the track to jump there
  const thumbDown = (e) => {
    const cy = cyRef.current
    e.stopPropagation(); e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const start = { y: e.clientY, at: vscroll(cy).at }
    const room = track.current.clientHeight - thumb.current.offsetHeight
    const move = (m) => scrollTo(cy, start.at + ((m.clientY - start.y) * vscroll(cy).max) / room)
    const up = () => { e.target.removeEventListener('pointermove', move); e.target.removeEventListener('pointerup', up) }
    e.target.addEventListener('pointermove', move)
    e.target.addEventListener('pointerup', up)
  }
  const trackDown = (e) => {
    const cy = cyRef.current, t = track.current.getBoundingClientRect(), h = thumb.current.offsetHeight
    scrollTo(cy, ((e.clientY - t.top - h / 2) / (t.height - h)) * vscroll(cy).max, true)
  }

  // create the graph once
  useEffect(() => {
    const cy = cytoscape({
      container: box.current, style: style(), boxSelectionEnabled: true, minZoom: 0.03, maxZoom: 3,
    })
    cyRef.current = cy

    // labels ride along when their drawing is dragged
    cy.on('position', 'node.img', (e) => {
      const l = cy.getElementById(`b${e.target.id()}`)
      if (l.nonempty()) l.position(labelAt(e.target.position()))
    })

    let held = 0 // a long-press (label editing) shouldn't also open the drawing on release
    cy.on('taphold', 'node.img', () => { held = Date.now() })
    cy.on('tap', 'node.img', (e) => {
      const k = e.originalEvent
      if (Date.now() - held < 1500 || connectRef.current || k?.shiftKey || k?.ctrlKey || k?.metaKey) return // modifier-click = select
      go.current(`/i/${e.target.id()}`)
    })

    // wheel / trackpad scrolls the page like a document; ctrl+wheel or pinch zooms around the cursor.
    // (Caught on the parent before cytoscape sees it; touch pinch/drag are still cytoscape's own.)
    const wheel = (e) => {
      e.preventDefault(); e.stopPropagation()
      const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? cy.height() : 1
      if (e.ctrlKey || e.metaKey) {
        const r = box.current.getBoundingClientRect()
        const level = Math.min(cy.maxZoom(), Math.max(cy.minZoom(), cy.zoom() * Math.exp(-e.deltaY * k * 0.01)))
        cy.zoom({ level, renderedPosition: { x: e.clientX - r.left, y: e.clientY - r.top } })
        return
      }
      const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX, dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY
      cy.panBy({ x: -dx * k, y: -dy * k })
      // keep the graph from scrolling off screen
      const b = cy.nodes().renderedBoundingBox()
      const keep = (lo, hi, size) => (hi - lo + 2 * PAD <= size ? 0 : lo > PAD ? PAD - lo : hi < size - PAD ? size - PAD - hi : 0)
      cy.panBy({ x: keep(b.x1, b.x2, cy.width()), y: keep(b.y1, b.y2, cy.height()) })
    }
    // keep the scroll bar in step with whatever moved the view
    cy.on('render', () => {
      const t = track.current, th = thumb.current
      if (!t) return
      const { at, max } = vscroll(cy), H = t.clientHeight
      t.style.display = max > 1 ? '' : 'none'
      if (max <= 1) return
      const h = Math.max(32, (H * cy.height()) / (max + cy.height()))
      th.style.height = `${h}px`
      th.style.transform = `translateY(${(H - h) * Math.min(1, Math.max(0, at / max))}px)`
    })

    const host = box.current.parentElement
    host.addEventListener('wheel', wheel, { capture: true, passive: false })

    return () => { host.removeEventListener('wheel', wheel, { capture: true }); cy.destroy(); cyRef.current = null }
  }, [])

  // admin: connecting / unlinking
  useEffect(() => {
    const cy = cyRef.current
    if (!admin) return
    const eh = cy.edgehandles({
      snap: true, noEdgeEventsInDraw: true,
      canConnect: (s, t) => s.hasClass('img') && t.hasClass('img') && !s.same(t) && !s.edgesTo(t).length && !t.edgesTo(s).length,
    })
    ehRef.current = eh
    const done = (_, s, t, added) => { added.remove(); save(api('/edges', 'POST', { parent: +s.id(), child: +t.id() })) }
    const unlink = (e) => {
      if (connectRef.current) return
      const x = e.target
      if (confirm('Remove this connection?')) save(api(`/edges/${x.source().id()}/${x.target().id()}`, 'DELETE'))
    }
    const rename = (e) => {
      if (connectRef.current) return
      const id = e.target.data('owner') || e.target.id()
      const old = cy.getElementById(`b${id}`).data('label') || ''
      const name = prompt('Branch label (starts at this drawing; empty removes it)', old)
      if (name != null && name.trim() !== old) save(api(`/images/${id}/branch`, 'PUT', { name }))
    }
    cy.on('ehcomplete', done)
    cy.on('tap', 'edge', unlink)
    cy.on('cxttap taphold', 'node.img', rename)
    cy.on('tap', 'node.branch', rename)
    return () => {
      cy.off('ehcomplete', done); cy.off('tap', 'edge', unlink); cy.off('cxttap taphold', 'node.img', rename); cy.off('tap', 'node.branch', rename)
      eh.destroy(); ehRef.current = null
    }
  }, [admin])

  useEffect(() => {
    connectRef.current = connect
    const eh = ehRef.current
    if (eh) connect ? eh.enableDrawMode() : eh.disableDrawMode()
  }, [connect])

  // sync drawings into the graph; only re-run the layout when nodes/links actually changed
  useEffect(() => {
    const cy = cyRef.current
    if (!cy || !images) return
    const els = elements(images, admin)
    const ids = new Set(els.map((e) => e.data.id))
    const first = cy.elements().empty()
    cy.batch(() => {
      cy.elements().filter((e) => !ids.has(e.id())).remove()
      els.forEach((e) => {
        const x = cy.getElementById(e.data.id)
        if (x.nonempty()) { x.data(e.data); if (e.group === 'nodes') x.classes(e.classes) }
        else if (e.data.owner) cy.add({ ...e, position: labelAt(cy.getElementById(e.data.owner).position()) })
        else cy.add(e)
      })
    })
    const sig = els.map((e) => e.data.id).sort().join() + images.map((i) => i.date).join()
    cy.nodes('.branch').forEach((l) => l.position(labelAt(cy.getElementById(l.data('owner')).position())))
    if (sig === shape.current) return
    shape.current = sig
    const t = treeLayout(images, new Set(els.filter((e) => e.classes?.startsWith('img')).map((e) => e.data.id)))
    els.forEach((e) => { if (e.data.owner) t[e.data.id] = labelAt(t[e.data.owner]) })
    target.current = t
    cy.nodes().filter((n) => !n.scratch('placed')).forEach((n) => { n.position(target.current[n.id()]); n.scratch('placed', true) })
    arrange(first)
  }, [images, admin])

  return (
    <div className="graph">
      <div ref={box} className="gcanvas" />
      <div ref={track} className="gscroll" onPointerDown={trackDown}>
        <div ref={thumb} className="gthumb" onPointerDown={thumbDown} />
      </div>
      <Group className="gtools" gap="xs">
        <Button size="xs" variant="default" onClick={toStart} title="Start (Home)">↑ Start</Button>
        <Button size="xs" variant="default" onClick={toEnd} title="End (End)">↓ End</Button>
        <Button size="xs" variant="default" onClick={fitAll}>Fit all</Button>
        <Button size="xs" variant="default" onClick={() => fitWidth()}>Fit width</Button>
        <Button size="xs" variant="default" onClick={() => arrange()}>Reset</Button>
        {admin && <Button size="xs" variant={connect ? 'filled' : 'default'} onClick={() => setConnect((c) => !c)}>{connect ? 'Connecting…' : 'Connect'}</Button>}
      </Group>
    </div>
  )
}
