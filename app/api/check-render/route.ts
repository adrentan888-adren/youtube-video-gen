import { NextRequest, NextResponse } from 'next/server'

const SHOTSTACK_KEY = process.env.SHOTSTACK_API_KEY!

export async function GET(req: NextRequest) {
  const renderId = req.nextUrl.searchParams.get('renderId')
  if (!renderId) return NextResponse.json({ error: 'renderId required' }, { status: 400 })

  const res = await fetch(`https://api.shotstack.io/stage/render/${renderId}`, {
    headers: { 'x-api-key': SHOTSTACK_KEY },
  })

  if (!res.ok) {
    const txt = await res.text()
    return NextResponse.json({ error: `Shotstack check failed: ${txt.slice(0, 200)}` }, { status: 500 })
  }

  const body = await res.json()
  const status: string = body.response?.status
  const videoUrl: string = body.response?.url ?? ''

  if (status === 'done') return NextResponse.json({ status: 'done', videoUrl })
  if (status === 'failed') return NextResponse.json({ status: 'failed', error: body.response?.error })

  return NextResponse.json({ status: 'rendering' })
}
