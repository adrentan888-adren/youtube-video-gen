import { NextRequest, NextResponse } from 'next/server'
import type { ImageResult } from '@/lib/types'

const PEXELS_KEY = process.env.PEXELS_API_KEY!

export async function POST(req: NextRequest) {
  try {
    const { topic, count, orientation = 'horizontal' }: { topic: string; count: number; orientation?: string } = await req.json()
    const pexelsOrientation = orientation === 'vertical' ? 'portrait' : 'landscape'
    const query = topic.slice(0, 100)

    // Fetch enough pages to cover count (max 80 per page)
    const perPage = 80
    const pagesNeeded = Math.ceil(count / perPage)
    const photos: { src: { large2x: string } }[] = []

    for (let page = 1; page <= Math.min(pagesNeeded + 1, 3); page++) {
      const res = await fetch(
        `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${perPage}&page=${page}&orientation=${pexelsOrientation}`,
        { headers: { Authorization: PEXELS_KEY } }
      )
      if (!res.ok) {
        const txt = await res.text()
        throw new Error(`Pexels search failed (page ${page}): ${txt.slice(0, 100)}`)
      }
      const data = await res.json()
      photos.push(...(data.photos ?? []))
      if (photos.length >= count) break
    }

    if (photos.length === 0) throw new Error(`No photos found for topic: "${query}"`)

    // Fill all count slots, cycling through available photos if fewer than needed
    const results: ImageResult[] = Array.from({ length: count }, (_, i) => ({
      segmentIndex: i,
      imageUrl: photos[i % photos.length].src.large2x,
    }))

    return NextResponse.json({ imageResults: results })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
