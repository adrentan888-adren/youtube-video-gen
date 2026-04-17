import { NextRequest, NextResponse } from 'next/server'
import type { ImageTask, ImageResult } from '@/lib/types'

const KIE_KEY = process.env.KIE_AI_API_KEY!

export async function POST(req: NextRequest) {
  const { tasks }: { tasks: ImageTask[] } = await req.json()

  const completed: ImageResult[] = []
  const pending: ImageTask[] = []

  await Promise.all(
    tasks.map(async (task) => {
      const res = await fetch(
        `https://api.kie.ai/api/v1/gpt4o-image/record-info?taskId=${task.taskId}`,
        { headers: { Authorization: `Bearer ${KIE_KEY}` } }
      )

      if (!res.ok) {
        pending.push(task)
        return
      }

      const body = await res.json()
      const data = body.data

      if (!data || data.successFlag === 0) {
        pending.push(task)
        return
      }

      if (data.successFlag === 2) {
        throw new Error(`Image generation failed for segment ${task.segmentIndex}`)
      }

      if (data.successFlag === 1) {
        const urls: string[] = data.response?.resultUrls ?? data.response?.result_urls ?? []
        if (urls[0]) {
          completed.push({ segmentIndex: task.segmentIndex, imageUrl: urls[0] })
        } else {
          pending.push(task)
        }
      }
    })
  )

  return NextResponse.json({ completed, pending, done: pending.length === 0 })
}
