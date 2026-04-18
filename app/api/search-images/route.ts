import { NextRequest, NextResponse } from 'next/server'
import type { Segment, ImageResult } from '@/lib/types'

const PEXELS_KEY = process.env.PEXELS_API_KEY!

export async function POST(req: NextRequest) {
  try {
    const { segments, orientation = 'horizontal' }: { segments: Segment[]; orientation?: string } = await req.json()
    const pexelsOrientation = orientation === 'vertical' ? 'portrait' : 'landscape'

    const results = await Promise.all(
      segments.map(async (seg): Promise<ImageResult> => {
        // Use first 5 words of imagePrompt as search query for better results
        const query = seg.imagePrompt.split(' ').slice(0, 5).join(' ')

        const res = await fetch(
          `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=${pexelsOrientation}`,
          { headers: { Authorization: PEXELS_KEY } }
        )

        if (!res.ok) {
          const txt = await res.text()
          throw new Error(`Pexels search failed for seg ${seg.segmentIndex}: ${txt.slice(0, 100)}`)
        }

        const data = await res.json()
        const photo = data.photos?.[0]

        if (!photo) {
          // Fallback: retry with just the first 2 words
          const fallbackQuery = seg.imagePrompt.split(' ').slice(0, 2).join(' ')
          const fallbackRes = await fetch(
            `https://api.pexels.com/v1/search?query=${encodeURIComponent(fallbackQuery)}&per_page=1&orientation=${pexelsOrientation}`,
            { headers: { Authorization: PEXELS_KEY } }
          )
          const fallbackData = await fallbackRes.json()
          const fallbackPhoto = fallbackData.photos?.[0]
          if (!fallbackPhoto) throw new Error(`No photo found for segment ${seg.segmentIndex}: "${query}"`)
          return { segmentIndex: seg.segmentIndex, imageUrl: fallbackPhoto.src.large2x }
        }

        return { segmentIndex: seg.segmentIndex, imageUrl: photo.src.large2x }
      })
    )

    return NextResponse.json({ imageResults: results })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
