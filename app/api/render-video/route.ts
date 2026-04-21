import { NextRequest, NextResponse } from 'next/server'

const FFMPEG_URL = process.env.FFMPEG_SERVER_URL!

type Word = { word: string; start: number; end: number }

export async function POST(req: NextRequest) {
  try {
    const {
      imageUrls,
      audioUrls,
      words,
      title,
      clipDuration = 5,
      orientation = 'horizontal',
      styleId = 'tiktok-box',
    }: {
      imageUrls: string[]
      audioUrls: string[]
      words: Word[]
      title: string
      clipDuration?: number
      orientation?: string
      styleId?: string
    } = await req.json()

    const res = await fetch(`${FFMPEG_URL}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageUrls,
        audioUrls,
        words,       // pre-transcribed — Railway skips whisper
        clipDuration,
        orientation,
        styleId,
      }),
    })

    if (!res.ok) {
      const txt = await res.text()
      return NextResponse.json({ error: `FFmpeg server error: ${txt.slice(0, 200)}` }, { status: 500 })
    }

    const { jobId } = await res.json()
    if (!jobId) return NextResponse.json({ error: 'No jobId from FFmpeg server' }, { status: 500 })

    return NextResponse.json({ renderId: jobId, title })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
