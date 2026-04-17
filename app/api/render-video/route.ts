import { NextRequest, NextResponse } from 'next/server'
import type { Segment, ImageResult } from '@/lib/types'

const SHOTSTACK_KEY = process.env.SHOTSTACK_API_KEY!
const EFFECTS = ['zoomIn', 'zoomOut', 'slideLeft', 'slideRight']

function buildCaptionHtml(sectionTitle: string, segmentNumber: number): string {
  const num = String(segmentNumber).padStart(2, '0')
  return `<div style="display:flex;align-items:center;gap:14px;padding:0 64px;height:96px;"><span style="font-family:'Montserrat',sans-serif;font-size:28px;font-weight:900;color:#a78bfa;letter-spacing:2px;flex-shrink:0;">${num}</span><span style="font-family:'Montserrat',sans-serif;font-size:42px;font-weight:800;color:#ffffff;text-shadow:0 2px 16px rgba(0,0,0,0.9),0 0 40px rgba(0,0,0,0.7);letter-spacing:-0.5px;line-height:1.1;">${sectionTitle}</span></div>`
}

export async function POST(req: NextRequest) {
  const {
    segments,
    imageResults,
    audioUrl,
    title,
    clipDuration = 30,
  }: {
    segments: Segment[]
    imageResults: ImageResult[]
    audioUrl: string
    title: string
    clipDuration?: number
  } = await req.json()

  // Build a lookup from segmentIndex → imageUrl
  const imageMap = new Map(imageResults.map((r) => [r.segmentIndex, r.imageUrl]))

  // Sort segments by index
  const sorted = [...segments].sort((a, b) => a.segmentIndex - b.segmentIndex)

  const imageclips = sorted.map((seg, i) => ({
    asset: { type: 'image', src: imageMap.get(seg.segmentIndex) ?? '' },
    start: i * clipDuration,
    length: clipDuration,
    effect: EFFECTS[i % 4],
  }))

  const captionClips = sorted.map((seg, i) => ({
    asset: {
      type: 'html',
      html: buildCaptionHtml(seg.sectionTitle, seg.segmentNumber),
      css: "@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@700;800;900&display=swap');",
      width: 1280,
      height: 96,
      background: 'transparent',
    },
    start: i * clipDuration,
    length: clipDuration,
    position: 'bottom',
    offset: { x: 0, y: 0.08 },
  }))

  const timeline = {
    soundtrack: { src: audioUrl, effect: 'fadeOut' },
    tracks: [
      { clips: captionClips },
      { clips: imageclips },
    ],
  }

  const output = { format: 'mp4', resolution: 'hd', fps: 25 }

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
