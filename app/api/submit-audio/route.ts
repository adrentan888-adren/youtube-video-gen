import { NextRequest, NextResponse } from 'next/server'

const KIE_KEY = process.env.KIE_AI_API_KEY!
const MAX_TTS_CHARS = 4900

function splitNarration(text: string): { chunks: string[]; wordCounts: number[] } {
  if (text.length <= MAX_TTS_CHARS) {
    return { chunks: [text], wordCounts: [text.trim().split(/\s+/).length] }
  }
  const chunks: string[] = []
  const wordCounts: number[] = []
  let remaining = text.trim()
  while (remaining.length > MAX_TTS_CHARS) {
    let cutAt = remaining.lastIndexOf(' ', MAX_TTS_CHARS)
    if (cutAt <= 0) cutAt = MAX_TTS_CHARS
    const chunk = remaining.slice(0, cutAt).trim()
    chunks.push(chunk)
    wordCounts.push(chunk.split(/\s+/).length)
    remaining = remaining.slice(cutAt).trim()
  }
  if (remaining) {
    chunks.push(remaining)
    wordCounts.push(remaining.split(/\s+/).length)
  }
  return { chunks, wordCounts }
}

export async function POST(req: NextRequest) {
  try {
    const { narration, voice = 'Rachel' } = await req.json()
    const { chunks, wordCounts } = splitNarration(narration)

    const taskIds = await Promise.all(
      chunks.map(async (chunk) => {
        const res = await fetch('https://api.kie.ai/api/v1/jobs/createTask', {
          method: 'POST',
          headers: { Authorization: `Bearer ${KIE_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'elevenlabs/text-to-speech-turbo-2-5',
            input: { text: chunk, voice, speed: 1.0 },
          }),
        })
        if (!res.ok) {
          const txt = await res.text()
          throw new Error(`TTS submit failed: ${txt.slice(0, 200)}`)
        }
        const data = await res.json()
        const taskId = data.data?.taskId
        if (!taskId) throw new Error('No taskId from TTS')
        return taskId as string
      })
    )

    return NextResponse.json({ taskIds, wordCounts })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
