import { useMemo, useState } from 'react'
import { Button, FileInput, MultiSelect, Stack, Text, TextInput, Textarea } from '@mantine/core'
import { mutate as refresh } from 'swr'
import { api } from './api'

// Upload a new drawing (no `image`) or edit an existing one.
export default function ImageForm({ image, images, onDone }) {
  const [v, setV] = useState({
    title: image?.title ?? '',
    date: image?.date ?? new Date().toLocaleDateString('sv'), // local YYYY-MM-DD
    description: image?.description ?? '',
    parents: (image?.parents ?? []).map(String),
  })
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const preview = useMemo(() => file && URL.createObjectURL(file), [file])
  const set = (k) => (e) => setV({ ...v, [k]: e?.currentTarget ? e.currentTarget.value : e })

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      const data = { ...v, parents: v.parents.map(Number) }
      let res
      if (image) res = await api(`/images/${image.id}`, 'PATCH', data)
      else {
        const f = new FormData()
        f.append('file', file)
        for (const k in data) f.append(k, k === 'parents' ? JSON.stringify(data[k]) : data[k])
        res = await api('/images', 'POST', f)
      }
      await refresh('/images')
      onDone(res.id)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit}>
      <Stack>
        {!image && <FileInput label="Drawing" placeholder="Take a photo or pick a file" accept="image/*" value={file} onChange={setFile} required clearable />}
        {preview && <img src={preview} alt="" className="preview" />}
        <TextInput label="Title" placeholder={v.date} value={v.title} onChange={set('title')} />
        <TextInput label="Date" type="date" value={v.date} onChange={set('date')} required />
        <Textarea label="Description" description="Markdown works: **bold**, [link text](https://…)" autosize minRows={3}
          value={v.description} onChange={set('description')} />
        <MultiSelect label="Comes after (for the graph)" searchable clearable value={v.parents} onChange={set('parents')}
          data={(images || []).filter((i) => i.id !== image?.id).map((i) => ({ value: String(i.id), label: `${i.date} · ${i.title}` }))} />
        {err && <Text c="red" size="sm">{err}</Text>}
        <Button type="submit" loading={busy}>{image ? 'Save' : 'Upload'}</Button>
      </Stack>
    </form>
  )
}
