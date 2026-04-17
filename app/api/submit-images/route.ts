import { NextRequest, NextResponse } from 'next/server'
import type { Segment, ImageTask } from '@/lib/types'

const KIE_KEY = process.env.KIE_AI_API_KEY!

// kie.ai supported sizes
const SIZE_MAP: Record<string, string> = {
  vertical: '9:16',
  horizontal: '3:2',
}

export async function POST(req: NextRequest) {
  try {
    const { segments, orientation = 'horizontal' }: { segments: Segment[]; orientation?: string } = await req.json()
    const imageSize = SIZE_MAP[orientation] ?? '3:2'

    const results = await Promise.all(
      segments.map(async (seg) => {
        const res = await fetch('https://api.kie.ai/api/v1/gpt4o-image/generate', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${KIE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            prompt: seg.imagePrompt + '. Photorealistic, cinematic, high quality.',
            size: imageSize,
            nVariants: 1,
          }),
        })

        const txt = await res.text()

        if (!res.ok) {
          throw new Error(`Image submit failed for seg ${seg.segmentIndex}: ${txt.slice(0, 200)}`)
        }

        let data: { data?: { taskId?: string } }
        try {
          data = JSON.parse(txt)
        } catch {
          throw new Error(`Invalid JSON from kie.ai for seg ${seg.segmentIndex}: ${txt.slice(0, 100)}`)
        }

        const taskId: string = data.data?.taskId ?? ''
        if (!taskId) throw new Error(`No taskId for segment ${seg.segmentIndex}. Response: ${txt.slice(0, 100)}`)

        return { segmentIndex: seg.segmentIndex, taskId } as ImageTask
      })
    )

    return NextResponse.json({ tasks: results })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
