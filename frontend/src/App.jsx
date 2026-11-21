import { useEffect } from 'react'
import { Link, Route, Routes, useNavigate, useParams } from 'react-router'
import { Anchor, Button, Center, Group, Stack, Text, Title } from '@mantine/core'
import { mutate } from 'swr'
import { TITLE, token, useApi } from './api'
import Feed from './Feed'
import ImageView from './ImageView'
import Graph from './Graph'
import Admin from './Admin'

export default function App() {
  const { data: me, isLoading } = useApi('/me')
  const { data: images } = useApi(me ? '/images' : null)
  const hasGraph = me?.is_admin || images?.some((i) => i.parents.length)
  const nav = (to, label) => <Button component={Link} to={to} variant="subtle" size="compact-sm">{label}</Button>

  return (
    <>
      <header className="top">
        <Link to="/" className="brand">{TITLE}</Link>
        {me && (
          <Group gap={4} wrap="nowrap">
            {nav('/', 'Feed')}
            {hasGraph && nav('/graph', 'Graph')}
            {!!me.is_admin && nav('/admin', 'Admin')}
            <Text size="sm" c="dimmed" className="who">{me.name}</Text>
          </Group>
        )}
      </header>
      <Routes>
        <Route path="/invite/:t" element={<Invite />} />
        <Route path="/admin" element={<Admin me={me} />} />
        {me ? (
          <>
            <Route path="/" element={<Feed images={images} />} />
            <Route path="/i/:id" element={<ImageView me={me} images={images} />} />
            <Route path="/graph" element={<Graph me={me} images={images} />} />
          </>
        ) : (
          <Route path="*" element={!isLoading && <Locked />} />
        )}
      </Routes>
    </>
  )
}

function Invite() {
  const { t } = useParams()
  const go = useNavigate()
  useEffect(() => {
    token.set(t)
    mutate('/me').then(() => go('/', { replace: true }))
  }, [t, go])
  return null
}

const Locked = () => (
  <Center h="70dvh">
    <Stack align="center" gap="xs">
      <Title order={3}>Invite only</Title>
      <Text c="dimmed">Ask the artist for your personal link.</Text>
      <Anchor component={Link} to="/admin" size="xs" c="dimmed">Artist login</Anchor>
    </Stack>
  </Center>
)
