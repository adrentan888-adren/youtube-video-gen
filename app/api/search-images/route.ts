import { NextRequest, NextResponse } from 'next/server'
import type { ImageResult } from '@/lib/types'

const PEXELS_KEY = process.env.PEXELS_API_KEY!

export async function POST(req: NextRequest) {
  try {
    const { keywords, orientation = 'horizontal' }: { keywords: string[]; orientation?: string } = await req.json()
    const pexelsOrientation = orientation === 'vertical' ? 'portrait' : 'landscape'

    const results = await Promise.all(
      keywords.map(async (keyword, index): Promise<ImageResult> => {
        const query = keyword.slice(0, 100)

        const res = await fetch(
          `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=5&orientation=${pexelsOrientation}`,
          { headers: { Authorization: PEXELS_KEY } }
        )

        if (!res.ok) {
          const txt = await res.text()
          throw new Error(`Pexels search failed for index ${index}: ${txt.slice(0, 100)}`)
        }

        const data = await res.json()
        const photos = data.photos ?? []
        const photo = photos[index % Math.max(photos.length, 1)] ?? photos[0]

        if (!photo) {
          // Fallback: simpler 2-word query
          const fallbackQuery = query.split(' ').slice(0, 2).join(' ')
          const fallbackRes = await fetch(
            `https://api.pexels.com/v1/search?query=${encodeURIComponent(fallbackQuery)}&per_page=3&orientation=${pexelsOrientation}`,
            { headers: { Authorization: PEXELS_KEY } }
          )
          const fallbackData = await fallbackRes.json()
          const fallbackPhoto = (fallbackData.photos ?? [])[0]
          if (!fallbackPhoto) throw new Error(`No photo found for index ${index}: "${query}"`)
          return { segmentIndex: index, imageUrl: fallbackPhoto.src.large2x }
        }

        return { segmentIndex: index, imageUrl: photo.src.large2x }
      })
    )

    return NextResponse.json({ imageResults: results })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
