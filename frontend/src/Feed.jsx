import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import { Button, Center, Text } from '@mantine/core'
import { Md, img } from './api'

// Vertical, snap-scrolling feed: one drawing per screen, newest first.
export default function Feed({ images }) {
  const feed = useRef(null)
  // keys: ↑/↓ and PageUp/PageDown = previous/next drawing, Home/End = newest/oldest
  useEffect(() => {
    const key = (e) => {
      const el = feed.current, t = e.target
      if (!el || e.altKey || e.ctrlKey || e.metaKey || t.closest?.('input, textarea, select, [contenteditable="true"]')) return
      const h = el.clientHeight
      const to = { ArrowUp: el.scrollTop - h, PageUp: el.scrollTop - h, ArrowDown: el.scrollTop + h, PageDown: el.scrollTop + h, Home: 0, End: el.scrollHeight }[e.key]
      if (to === undefined) return
      e.preventDefault()
      el.scrollTo({ top: to, behavior: 'smooth' })
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  if (!images) return null
  if (!images.length) return <Center h="60dvh"><Text c="dimmed">No drawings yet.</Text></Center>
  return (
    <div className="feed" ref={feed}>
      {images.map((i) => (
        <section key={i.id} className="slide">
          <Link to={`/i/${i.id}`} className="slide-img">
            <img src={img(i.full)} alt={i.title} loading="lazy" />
          </Link>
          <div className="slide-info">
            <Text fw={600}>{i.title}</Text>
            <Text size="xs" c="dimmed">{i.date}</Text>
            {i.description && <Md>{i.description}</Md>}
            <Button component={Link} to={`/i/${i.id}`} size="compact-sm" variant="light" mt={6}>
              💬 {i.comments ? `${i.comments} feedback` : 'Give feedback'}
            </Button>
          </div>
        </section>
      ))}
    </div>
  )
}
