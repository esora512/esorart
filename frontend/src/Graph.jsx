import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import { Background, Controls, Handle, Position, ReactFlow } from '@xyflow/react'
import dagre from '@dagrejs/dagre'
import { mutate as refresh } from 'swr'
import { api, img } from './api'

const W = 150, H = 190

const ImgNode = ({ data }) => (
  <div className={'gnode' + (data.tip ? ' tip' : '')} title={data.tip ? 'Latest on this path' : ''}>
    <Handle type="target" position={Position.Left} />
    <img src={data.src} alt="" draggable={false} />
    <div className="gtitle">{data.title}</div>
    <Handle type="source" position={Position.Right} />
  </div>
)
const nodeTypes = { img: ImgNode }

// Learning path: drawings are nodes, "comes after" links are edges, laid out left → right by dagre.
export default function Graph({ me, images }) {
  const go = useNavigate()
  const { nodes, edges } = useMemo(() => {
    if (!images) return { nodes: [], edges: [] }
    const edges = images.flatMap((i) => i.parents.map((p) => ({ id: `${p}-${i.id}`, source: String(p), target: String(i.id) })))
    const linked = new Set(edges.flatMap((e) => [e.source, e.target]))
    const hasChild = new Set(edges.map((e) => e.source))
    const shown = me.is_admin ? images : images.filter((i) => linked.has(String(i.id))) // admin also sees unlinked ones
    const g = new dagre.graphlib.Graph().setGraph({ rankdir: 'LR', nodesep: 24, ranksep: 70 }).setDefaultEdgeLabel(() => ({}))
    shown.forEach((i) => g.setNode(String(i.id), { width: W, height: H }))
    edges.forEach((e) => g.setEdge(e.source, e.target))
    dagre.layout(g)
    const nodes = shown.map((i) => {
      const id = String(i.id), p = g.node(id)
      return { id, type: 'img', position: { x: p.x - W / 2, y: p.y - H / 2 }, data: { src: img(i.thumb), title: i.title, tip: linked.has(id) && !hasChild.has(id) } }
    })
    return { nodes, edges }
  }, [images, me])

  const save = (p) => p.then(() => refresh('/images'))
  const admin = !!me.is_admin
  return (
    <div className="graph">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} forceColorMode="dark" fitView
        nodesDraggable={false} nodesConnectable={admin} deleteKeyCode={null} proOptions={{ hideAttribution: true }}
        onNodeClick={(_, n) => go(`/i/${n.id}`)}
        onConnect={(c) => admin && save(api('/edges', 'POST', { parent: +c.source, child: +c.target }))}
        onEdgeClick={(_, e) => admin && confirm('Remove this connection?') && save(api(`/edges/${e.source}/${e.target}`, 'DELETE'))}>
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
      {admin && <div className="ghint">Connect: drag from a drawing's right dot to another's left dot. Click a line to remove it. Unconnected drawings are only shown to you.</div>}
    </div>
  )
}
