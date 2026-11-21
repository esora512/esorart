import { Link } from 'react-router'
import { Button, Center, Text } from '@mantine/core'
import { Md, img } from './api'

// Vertical, snap-scrolling feed: one drawing per screen, newest first.
export default function Feed({ images }) {
  if (!images) return null
  if (!images.length) return <Center h="60dvh"><Text c="dimmed">No drawings yet.</Text></Center>
  return (
    <div className="feed">
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
