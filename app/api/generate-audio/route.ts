import { NextRequest, NextResponse } from 'next/server'

const FFMPEG_URL = process.env.FFMPEG_SERVER_URL!
const MAX_TTS_CHARS = 4900

export const maxDuration = 120 // 2 min Vercel timeout

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
    const { narration, voice = 'en-US-JennyNeural' } = await req.json()
    const { chunks, wordCounts } = splitNarration(narration)

    const res = await fetch(`${FFMPEG_URL}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chunks, voice }),
    })

    if (!res.ok) {
      const txt = await res.text()
      return NextResponse.json({ error: `TTS failed: ${txt.slice(0, 200)}` }, { status: 500 })
    }

    const { audioUrls } = await res.json()
    return NextResponse.json({ audioUrls, wordCounts })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
