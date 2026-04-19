import { NextRequest, NextResponse } from 'next/server'
import type { Segment, ImageResult } from '@/lib/types'

const SHOTSTACK_KEY = process.env.SHOTSTACK_API_KEY!
const EFFECTS = ['zoomIn', 'zoomOut', 'slideLeft', 'slideRight']
const WORDS_PER_SEC = 2.2
const CHUNK_SIZE = 6

function buildSubtitleHtml(text: string, isVertical: boolean): string {
  const fontSize = isVertical ? '38px' : '34px'
  return `<div style="display:flex;align-items:center;justify-content:center;padding:12px 24px;background:rgba(0,0,0,0.55);border-radius:10px;"><span style="font-family:'Montserrat',sans-serif;font-size:${fontSize};font-weight:800;color:#ffffff;text-shadow:0 2px 8px rgba(0,0,0,0.9);letter-spacing:-0.3px;line-height:1.3;text-align:center;">${text}</span></div>`
}

function generateSubtitleClips(
  segments: Segment[],
  clipDuration: number,
  isVertical: boolean
) {
  const clips = []
  const width = isVertical ? 680 : 1220
  const height = 130

  const sorted = [...segments].sort((a, b) => a.segmentIndex - b.segmentIndex)

  for (const seg of sorted) {
    const segStart = seg.segmentIndex * clipDuration
    const words = seg.narration.trim().split(/\s+/)

    let wordOffset = 0
    while (wordOffset < words.length) {
      const chunk = words.slice(wordOffset, wordOffset + CHUNK_SIZE)
      const chunkStart = segStart + wordOffset / WORDS_PER_SEC
      const chunkDuration = chunk.length / WORDS_PER_SEC
      const clampedEnd = Math.min(chunkStart + chunkDuration, segStart + clipDuration - 0.1)
      const clampedDuration = Math.max(0.2, clampedEnd - chunkStart)

      clips.push({
        asset: {
          type: 'html',
          html: buildSubtitleHtml(chunk.join(' '), isVertical),
          css: "@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@800;900&display=swap');",
          width,
          height,
          background: 'transparent',
        },
        start: Math.round(chunkStart * 100) / 100,
        length: Math.round(clampedDuration * 100) / 100,
        position: 'bottom',
        offset: { x: 0, y: isVertical ? 0.12 : 0.08 },
      })

      wordOffset += CHUNK_SIZE
    }
  }

  return clips
}

export async function POST(req: NextRequest) {
  const {
    segments,
    imageResults,
    audioUrl,
    audioUrls,
    wordCounts,
    title,
    clipDuration = 30,
    orientation = 'horizontal',
  }: {
    segments: Segment[]
    imageResults: ImageResult[]
    audioUrl?: string
    audioUrls?: string[]
    wordCounts?: number[]
    title: string
    clipDuration?: number
    orientation?: string
  } = await req.json()

  const isVertical = orientation === 'vertical'
  const totalDuration = segments.length * clipDuration

  // Support both legacy single audioUrl and new multi-chunk audioUrls
  const allAudioUrls: string[] = audioUrls ?? (audioUrl ? [audioUrl] : [])
  const wc: number[] = wordCounts ?? (allAudioUrls.length === 1 ? [999999] : [])

  // Build audio clips with time offsets derived from word counts
  let offset = 0
  const audioClips = allAudioUrls.map((url, i) => {
    const start = Math.round(offset * 100) / 100
    const length = Math.round((totalDuration - offset) * 100) / 100
    offset += (wc[i] ?? 0) / WORDS_PER_SEC
    return {
      asset: { type: 'audio', src: url, volume: 1 },
      start,
      length: Math.max(1, length),
    }
  })

  const imageMap = new Map(imageResults.map((r) => [r.segmentIndex, r.imageUrl]))
  const sorted = [...segments].sort((a, b) => a.segmentIndex - b.segmentIndex)

  const imageclips = sorted.map((seg, i) => ({
    asset: { type: 'image', src: imageMap.get(seg.segmentIndex) ?? '' },
    start: i * clipDuration,
    length: clipDuration,
    effect: EFFECTS[i % 4],
  }))

  const subtitleClips = generateSubtitleClips(segments, clipDuration, isVertical)

  const timeline = {
    tracks: [
      { clips: subtitleClips },
      { clips: imageclips },
      { clips: audioClips },
    ],
  }

  const output = isVertical
    ? { format: 'mp4', resolution: 'hd', size: { width: 720, height: 1280 }, fps: 25 }
    : { format: 'mp4', resolution: 'hd', fps: 25 }

  const res = await fetch('https://api.shotstack.io/stage/render', {
    method: 'POST',
    headers: {
      'x-api-key': SHOTSTACK_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ timeline, output }),
  })

  if (!res.ok) {
    const txt = await res.text()
    return NextResponse.json({ error: `Shotstack error: ${txt.slice(0, 300)}` }, { status: 500 })
  }

  const data = await res.json()
  const renderId: string = data.response?.id

  if (!renderId) {
    return NextResponse.json({ error: 'No renderId from Shotstack' }, { status: 500 })
  }

  return NextResponse.json({ renderId, title })
}
