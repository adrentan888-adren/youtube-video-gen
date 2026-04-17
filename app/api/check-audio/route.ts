import { NextRequest, NextResponse } from 'next/server'

const KIE_KEY = process.env.KIE_AI_API_KEY!

export async function GET(req: NextRequest) {
  const taskId = req.nextUrl.searchParams.get('taskId')
  if (!taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 })

  const res = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
    headers: { Authorization: `Bearer ${KIE_KEY}` },
  })

  if (!res.ok) {
    const txt = await res.text()
    return NextResponse.json({ error: `TTS check failed: ${txt.slice(0, 200)}` }, { status: 500 })
  }

  const body = await res.json()
  const data = body.data

  if (!data) return NextResponse.json({ status: 'pending' })

  if (data.state === 'failed') return NextResponse.json({ status: 'failed' })

  if (data.state === 'success') {
    const resultJson = JSON.parse(data.resultJson ?? '{}')
    const audioUrl: string = resultJson.resultUrls?.[0] ?? ''
    if (!audioUrl) return NextResponse.json({ status: 'pending' })
    return NextResponse.json({ status: 'done', audioUrl })
  }

  return NextResponse.json({ status: 'pending' })
}
