import { NextRequest, NextResponse } from 'next/server'
import type { Segment, ImageResult } from '@/lib/types'

const FFMPEG_URL = process.env.FFMPEG_SERVER_URL!

export async function POST(req: NextRequest) {
  try {
    const {
      segments,
      imageResults,
      audioUrls,
      wordCounts,
      title,
      clipDuration = 30,
      orientation = 'horizontal',
      styleId = 'tiktok-box',
    }: {
      segments: Segment[]
      imageResults: ImageResult[]
      audioUrls: string[]
      wordCounts: number[]
      title: string
      clipDuration?: number
      orientation?: string
      styleId?: string
    } = await req.json()

    const sorted = [...segments].sort((a, b) => a.segmentIndex - b.segmentIndex)
    const imageMap = new Map(imageResults.map((r) => [r.segmentIndex, r.imageUrl]))
    const imageUrls = sorted.map((s) => imageMap.get(s.segmentIndex) ?? '')

    const res = await fetch(`${FFMPEG_URL}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageUrls,
        audioUrls,
        wordCounts,
        segments: sorted,
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
