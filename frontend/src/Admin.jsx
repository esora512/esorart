import { useState } from 'react'
import { useNavigate } from 'react-router'
import { GoogleLogin } from '@react-oauth/google'
import { Badge, Button, Center, Code, Container, CopyButton, Group, Paper, Stack, Table, Tabs, Text, TextInput, Title } from '@mantine/core'
import { mutate as refresh } from 'swr'
import { GOOGLE, api, token, useApi } from './api'
import ImageForm from './ImageForm'

export default function Admin({ me }) {
  if (!me?.is_admin) return <Login />
  return (
    <Container size="sm" py="md">
      <Tabs defaultValue="upload">
        <Tabs.List>
          <Tabs.Tab value="upload">Upload</Tabs.Tab>
          <Tabs.Tab value="friends">Friends</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="upload" pt="md"><Upload /></Tabs.Panel>
        <Tabs.Panel value="friends" pt="md"><Friends /></Tabs.Panel>
      </Tabs>
    </Container>
  )
}

function Upload() {
  const go = useNavigate()
  const { data: images } = useApi('/images')
  return <ImageForm images={images} onDone={(id) => go(`/i/${id}`)} />
}

function Login() {
  const [err, setErr] = useState('')
  const ok = async ({ credential }) => {
    try {
      const { token: t } = await api('/auth/google', 'POST', { credential })
      token.set(t)
      refresh('/me')
    } catch (e) { setErr(e.message) }
  }
  return (
    <Center h="60dvh">
      <Stack align="center">
        <Title order={3}>Artist login</Title>
        {GOOGLE
          ? <GoogleLogin onSuccess={ok} onError={() => setErr('Google sign-in failed')} theme="filled_black" />
          : <Text c="dimmed" size="sm" ta="center">Google sign-in isn't set up.<br />On the server run <Code>python main.py admin-link</Code></Text>}
        {err && <Text c="red" size="sm">{err}</Text>}
      </Stack>
    </Center>
  )
}

function Friends() {
  const { data: users, mutate } = useApi('/users')
  const [name, setName] = useState('')
  const [link, setLink] = useState(null)
  const show = (who, t) => setLink({ who, url: `${location.origin}${location.pathname}#/invite/${t}` })

  const add = async (e) => {
    e.preventDefault()
    const r = await api('/users', 'POST', { name })
    show(name, r.token); setName(''); mutate()
  }
  const relink = async (u) => { show(u.name, (await api(`/users/${u.id}/link`, 'POST')).token); mutate() }
  const revoke = async (u) => { if (confirm(`Revoke all of ${u.name}'s links?`)) { await api(`/users/${u.id}/link`, 'DELETE'); mutate() } }

  return (
    <Stack>
      <form onSubmit={add}>
        <Group align="end">
          <TextInput label="Friend's name" value={name} onChange={(e) => setName(e.currentTarget.value)} required style={{ flex: 1 }} />
          <Button type="submit">Create invite</Button>
        </Group>
      </form>
      {link && (
        <Paper withBorder p="sm">
          <Text size="sm">Send this to <b>{link.who}</b>. It's only shown once:</Text>
          <Group wrap="nowrap" mt={6}>
            <Code className="link">{link.url}</Code>
            <CopyButton value={link.url}>{({ copied, copy }) => <Button size="xs" onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>}</CopyButton>
          </Group>
        </Paper>
      )}
      <Table>
        <Table.Tbody>
          {users?.filter((u) => !u.is_admin).map((u) => (
            <Table.Tr key={u.id}>
              <Table.Td>{u.name}</Table.Td>
              <Table.Td><Badge variant="light" color={u.links ? 'green' : 'gray'}>{u.links ? 'active' : 'revoked'}</Badge></Table.Td>
              <Table.Td ta="right">
                <Button size="compact-xs" variant="subtle" onClick={() => relink(u)}>New link</Button>
                {u.links > 0 && <Button size="compact-xs" variant="subtle" color="red" onClick={() => revoke(u)}>Revoke</Button>}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  )
}
