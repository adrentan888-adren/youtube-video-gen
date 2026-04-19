import { NextRequest, NextResponse } from 'next/server'

const FFMPEG_URL = process.env.FFMPEG_SERVER_URL!

export async function GET(req: NextRequest) {
  const renderId = req.nextUrl.searchParams.get('renderId')
  if (!renderId) return NextResponse.json({ error: 'renderId required' }, { status: 400 })

  try {
    const res = await fetch(`${FFMPEG_URL}/status/${renderId}`)
    if (!res.ok) {
      const txt = await res.text()
      return NextResponse.json({ error: `FFmpeg status error: ${txt.slice(0, 200)}` }, { status: 500 })
    }

    const { status, videoUrl, error, progress } = await res.json()

    if (status === 'done') {
      const secureUrl = typeof videoUrl === 'string' ? videoUrl.replace(/^http:\/\//, 'https://') : videoUrl
      return NextResponse.json({ status: 'done', videoUrl: secureUrl })
    }
    if (status === 'failed') return NextResponse.json({ status: 'failed', error })

    return NextResponse.json({ status: 'rendering', progress })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
