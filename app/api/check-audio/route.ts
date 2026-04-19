import { NextRequest, NextResponse } from 'next/server'

const KIE_KEY = process.env.KIE_AI_API_KEY!

async function checkOne(taskId: string): Promise<{ status: 'done' | 'pending' | 'failed'; url?: string }> {
  const res = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
    headers: { Authorization: `Bearer ${KIE_KEY}` },
  })
  if (!res.ok) return { status: 'failed' }
  const body = await res.json()
  const data = body.data
  if (!data) return { status: 'pending' }
  if (data.state === 'failed') return { status: 'failed' }
  if (data.state === 'success') {
    const resultJson = JSON.parse(data.resultJson ?? '{}')
    const url: string = resultJson.resultUrls?.[0] ?? ''
    if (!url) return { status: 'pending' }
    return { status: 'done', url }
  }
  return { status: 'pending' }
}

export async function GET(req: NextRequest) {
  // Accept comma-separated taskIds or legacy single taskId
  const raw = req.nextUrl.searchParams.get('taskIds') ?? req.nextUrl.searchParams.get('taskId')
  if (!raw) return NextResponse.json({ error: 'taskIds required' }, { status: 400 })

  const taskIds = raw.split(',').filter(Boolean)

  try {
    const results = await Promise.all(taskIds.map(checkOne))

    if (results.some((r) => r.status === 'failed')) return NextResponse.json({ status: 'failed' })
    if (results.some((r) => r.status === 'pending')) return NextResponse.json({ status: 'pending' })

    const audioUrls = results.map((r) => r.url as string)
    // Legacy compat: if only one URL, also return audioUrl
    return NextResponse.json({ status: 'done', audioUrls, audioUrl: audioUrls[0] })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
