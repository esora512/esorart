import { useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch'
import { Badge, Button, CloseButton, Divider, Group, Modal, Paper, SegmentedControl, Stack, Switch, Text, Textarea, Title } from '@mantine/core'
import { mutate as refresh } from 'swr'
import { Md, api, img, useApi } from './api'
import ImageForm from './ImageForm'

const COLORS = ['#ff6b6b', '#4dabf7', '#69db7c', '#ffd43b', '#da77f2', '#ff922b', '#3bc9db', '#f783ac']
const TOOLS = [
  { value: '', label: 'Zoom' }, { value: 'point', label: '• Point' }, { value: 'circle', label: '◯ Circle' },
  { value: 'rect', label: '▭ Box' }, { value: 'arrow', label: '➚ Arrow' }, { value: 'pen', label: '✎ Draw' },
]

// Shapes use units where the image width is 1, so they stay put at any size or zoom.
function Shape({ s, color, n, active }) {
  const p = { fill: 'none', stroke: color, strokeWidth: active ? 5 : 3, vectorEffect: 'non-scaling-stroke', strokeLinecap: 'round', strokeLinejoin: 'round' }
  const { x, y, x2 = x, y2 = y } = s
  const a = Math.atan2(y2 - y, x2 - x), L = 0.03
  const el = {
    point: <circle cx={x} cy={y} r={active ? 0.016 : 0.012} fill={color} stroke="#fff" strokeWidth={2} vectorEffect="non-scaling-stroke" />,
    circle: <circle cx={x} cy={y} r={Math.hypot(x2 - x, y2 - y)} {...p} />,
    rect: <rect x={Math.min(x, x2)} y={Math.min(y, y2)} width={Math.abs(x2 - x)} height={Math.abs(y2 - y)} {...p} />,
    arrow: <path d={`M${x},${y}L${x2},${y2}M${x2 - L * Math.cos(a - 0.5)},${y2 - L * Math.sin(a - 0.5)}L${x2},${y2}L${x2 - L * Math.cos(a + 0.5)},${y2 - L * Math.sin(a + 0.5)}`} {...p} />,
    pen: <polyline points={s.pts?.join(' ')} {...p} />,
  }[s.t]
  const [lx, ly] = s.t === 'pen' ? s.pts[0] : [x, y]
  return (
    <g>
      {el}
      {n && <text x={lx + 0.015} y={ly - 0.015} fontSize={0.04} fontWeight="bold" fill={color} stroke="#000" strokeWidth={0.004} paintOrder="stroke">{n}</text>}
    </g>
  )
}

export default function ImageView({ me, images }) {
  const { id } = useParams()
  const go = useNavigate()
  const { data: comments, mutate } = useApi(`/images/${id}/comments`)
  const [tool, setTool] = useState('')
  const [draft, setDraft] = useState(null)
  const [body, setBody] = useState('')
  const [hidden, setHidden] = useState({})
  const [showAll, setShowAll] = useState(true)
  const [active, setActive] = useState(null)
  const [editing, setEditing] = useState(false)
  const svg = useRef()
  const drawing = useRef(false)

  const image = images?.find((i) => i.id === +id)
  if (!image) return null
  const marked = (comments || []).filter((c) => c.shape)

  const pt = (e) => {
    const r = svg.current.getBoundingClientRect()
    return [+((e.clientX - r.left) / r.width).toFixed(4), +((e.clientY - r.top) / r.width).toFixed(4)]
  }
  const down = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const [x, y] = pt(e)
    drawing.current = true
    setDraft(tool === 'pen' ? { t: 'pen', pts: [[x, y]] } : { t: tool, x, y, x2: x, y2: y })
  }
  const move = (e) => {
    if (!drawing.current) return
    const [x, y] = pt(e)
    setDraft((d) => (d.t === 'pen' ? { ...d, pts: [...d.pts, [x, y]] } : { ...d, x2: x, y2: y }))
  }
  const up = () => { drawing.current = false; setTool('') }

  const send = async () => {
    await api(`/images/${id}/comments`, 'POST', { body, shape: draft })
    setBody(''); setDraft(null); mutate(); refresh('/images')
  }
  const delComment = async (cid) => { if (confirm('Delete this comment?')) { await api(`/comments/${cid}`, 'DELETE'); mutate(); refresh('/images') } }
  const delImage = async () => { if (confirm('Delete this drawing and its feedback?')) { await api(`/images/${id}`, 'DELETE'); await refresh('/images'); go('/') } }

  return (
    <div className="viewer">
      <div className="stage-wrap">
        <TransformWrapper disabled={!!tool} doubleClick={{ mode: 'reset' }}>
          <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }} contentStyle={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="stage">
              <img src={img(image.full)} alt={image.title} draggable={false} />
              <svg ref={svg} viewBox={`0 0 1 ${image.h / image.w}`} className={tool ? 'drawing' : ''}
                onPointerDown={tool ? down : undefined} onPointerMove={move} onPointerUp={up}>
                {marked.map((c, n) => (showAll && !hidden[c.id]) || active === c.id
                  ? <Shape key={c.id} s={c.shape} color={COLORS[n % COLORS.length]} n={n + 1} active={active === c.id} /> : null)}
                {draft && <Shape s={draft} color="#fff" active />}
              </svg>
            </div>
          </TransformComponent>
        </TransformWrapper>
      </div>

      <aside className="side">
        <Group justify="space-between" wrap="nowrap">
          <Title order={4}>{image.title}</Title>
          {!!me.is_admin && (
            <Group gap={0} wrap="nowrap">
              <Button size="compact-xs" variant="subtle" onClick={() => setEditing(true)}>Edit</Button>
              <Button size="compact-xs" variant="subtle" color="red" onClick={delImage}>Delete</Button>
            </Group>
          )}
        </Group>
        <Text size="xs" c="dimmed">{image.date}</Text>
        {image.description && <Md>{image.description}</Md>}
        <Divider my="sm" />

        <Group justify="space-between">
          <Text fw={600}>Feedback</Text>
          {marked.length > 0 && <Switch size="xs" label="Markers" checked={showAll} onChange={(e) => setShowAll(e.currentTarget.checked)} />}
        </Group>
        <Stack gap="xs" my="xs">
          {comments?.map((c) => {
            const n = marked.indexOf(c)
            return (
              <Paper key={c.id} p="xs" withBorder className={active === c.id ? 'active' : ''}
                onClick={() => c.shape && setActive(active === c.id ? null : c.id)}>
                <Group gap={6} justify="space-between" wrap="nowrap">
                  <Group gap={6}>
                    {c.shape && (
                      <Badge color={COLORS[n % COLORS.length]} variant={hidden[c.id] ? 'outline' : 'filled'} style={{ cursor: 'pointer' }}
                        title="Show / hide marker" onClick={(e) => { e.stopPropagation(); setHidden({ ...hidden, [c.id]: !hidden[c.id] }) }}>
                        #{n + 1}
                      </Badge>
                    )}
                    <Text size="sm" fw={600}>{c.name}{c.is_admin ? ' ✦' : ''}</Text>
                    <Text size="xs" c="dimmed">{new Date(c.created_at * 1000).toLocaleString()}</Text>
                  </Group>
                  {(me.is_admin || c.user_id === me.id) && <CloseButton size="xs" onClick={(e) => { e.stopPropagation(); delComment(c.id) }} />}
                </Group>
                <Text size="sm" mt={4} style={{ whiteSpace: 'pre-wrap' }}>{c.body}</Text>
              </Paper>
            )
          })}
          {comments?.length === 0 && <Text size="sm" c="dimmed">No feedback yet.</Text>}
        </Stack>

        <Stack gap={6}>
          <Textarea placeholder="Your feedback…" autosize minRows={2} value={body} onChange={(e) => setBody(e.currentTarget.value)} />
          <Text size="xs" c="dimmed">{tool ? 'Draw on the image now.' : 'Optionally mark the spot you mean:'}</Text>
          <SegmentedControl size="xs" fullWidth data={TOOLS} value={tool} onChange={setTool} />
          <Group justify="space-between">
            {draft ? <Button size="compact-xs" variant="subtle" color="gray" onClick={() => setDraft(null)}>Remove marker</Button> : <span />}
            <Button onClick={send} disabled={!body.trim()}>Send</Button>
          </Group>
        </Stack>
      </aside>

      <Modal opened={editing} onClose={() => setEditing(false)} title="Edit drawing">
        <ImageForm image={image} images={images} onDone={() => setEditing(false)} />
      </Modal>
    </div>
  )
}
