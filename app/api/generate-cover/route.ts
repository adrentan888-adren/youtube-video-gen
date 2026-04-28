import { NextRequest, NextResponse } from 'next/server'

const KIE_KEY = process.env.KIE_AI_API_KEY!
const POLL_INTERVAL_MS = 3000
const POLL_TIMEOUT_MS = 120_000

export async function POST(req: NextRequest) {
  try {
    const { topic, orientation = 'horizontal' }: { topic: string; orientation?: string } = await req.json()
    if (!topic?.trim()) return NextResponse.json({ error: 'topic required' }, { status: 400 })

    const aspectRatio = orientation === 'vertical' ? '9:16' : '16:9'
    const prompt =
      `Create a first frame cover image for the topic "${topic}" that is suitable for social media platforms YouTube and TikTok. ` +
      `The image should be cinematic, visually striking, with dramatic lighting and high detail. ` +
      `Include bold visual elements that represent the topic. Style: epic, cinematic, high-resolution.`

    // Submit image generation task
    const createRes = await fetch('https://api.kie.ai/api/v1/jobs/createTask', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KIE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-image-2-text-to-image',
        input: { prompt, aspect_ratio: aspectRatio, resolution: '1K' },
      }),
    })

    if (!createRes.ok) {
      const txt = await createRes.text()
      return NextResponse.json({ error: `Image task create failed: ${txt.slice(0, 200)}` }, { status: 500 })
    }

    const createData = await createRes.json()
    const taskId: string = createData?.data?.taskId
    if (!taskId) return NextResponse.json({ error: `No taskId returned: ${JSON.stringify(createData).slice(0, 200)}` }, { status: 500 })

    // Poll until success or timeout
    const deadline = Date.now() + POLL_TIMEOUT_MS
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))

      const pollRes = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
        headers: { Authorization: `Bearer ${KIE_KEY}` },
      })
      if (!pollRes.ok) continue

      const pollData = await pollRes.json()
      const record = pollData?.data
      if (!record) continue

      const state: string = record.state ?? ''

      if (state === 'fail') {
        return NextResponse.json({ error: `Image generation failed for taskId ${taskId}` }, { status: 500 })
      }

      if (state === 'success') {
        let resultUrls: string[] = []
        try {
          const parsed = typeof record.resultJson === 'string' ? JSON.parse(record.resultJson) : record.resultJson
          resultUrls = parsed?.resultUrls ?? []
        } catch { /* ignore */ }

        const coverUrl = resultUrls[0]
        if (!coverUrl) return NextResponse.json({ error: 'No result URL in completed task' }, { status: 500 })

        return NextResponse.json({ coverUrl, imagePrompt: prompt })
      }
      // else: waiting/queuing/generating — keep polling
    }

    return NextResponse.json({ error: `Image generation timed out after ${POLL_TIMEOUT_MS / 1000}s` }, { status: 504 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
