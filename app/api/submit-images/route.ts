import { NextRequest, NextResponse } from 'next/server'
import type { Segment, ImageTask } from '@/lib/types'

const KIE_KEY = process.env.KIE_AI_API_KEY!

export async function POST(req: NextRequest) {
  const { segments }: { segments: Segment[] } = await req.json()

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
          size: '3:2',
          nVariants: 1,
        }),
      })

      if (!res.ok) {
        const txt = await res.text()
        throw new Error(`Image submit failed for seg ${seg.segmentIndex}: ${txt.slice(0, 100)}`)
      }

      const data = await res.json()
      const taskId: string = data.data?.taskId
      if (!taskId) throw new Error(`No taskId for segment ${seg.segmentIndex}`)

      return { segmentIndex: seg.segmentIndex, taskId } as ImageTask
    })
  )

  return NextResponse.json({ tasks: results })
}
