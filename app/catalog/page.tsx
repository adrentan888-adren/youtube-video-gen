import Link from 'next/link'
import { SUBTITLE_STYLES } from '@/lib/subtitle-styles'

const SAMPLE_TEXT = 'Julius Caesar crossed the Rubicon River in 49 BC'

export default function CatalogPage() {
  return (
    <main className="min-h-screen bg-[#0a0a0f] px-6 py-14">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-12 text-center">
          <Link href="/" className="text-white/40 text-sm hover:text-white/70 transition-colors">
            ← Back to generator
          </Link>
          <h1 className="mt-6 text-4xl font-bold text-white">Subtitle Style Catalog</h1>
          <p className="mt-3 text-white/50 text-base">
            Choose a style when generating your video. Each preview shows exactly how it looks burned into the video.
          </p>
        </div>

        {/* Style grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {SUBTITLE_STYLES.map((style) => (
            <div key={style.id} className="rounded-2xl overflow-hidden border border-white/10 bg-white/5">
              {/* Preview canvas */}
              <div className="relative w-full aspect-video bg-gradient-to-br from-slate-800 to-slate-950 flex items-end justify-center pb-6"
                style={style.position === 'top' ? { alignItems: 'flex-start', paddingBottom: 0, paddingTop: '24px' } : {}}>
                {/* Fake video content lines */}
                <div className="absolute inset-0 opacity-20 flex flex-col justify-center items-center gap-2 px-8">
                  <div className="w-full h-1 bg-white/30 rounded" />
                  <div className="w-3/4 h-1 bg-white/20 rounded" />
                  <div className="w-5/6 h-1 bg-white/20 rounded" />
                  <div className="w-2/3 h-1 bg-white/10 rounded" />
                </div>
                {/* Subtitle text */}
                <span
                  className="relative z-10 text-sm font-sans text-center max-w-xs leading-snug"
                  style={style.css as React.CSSProperties}
                >
                  {SAMPLE_TEXT}
                </span>
              </div>

              {/* Info */}
              <div className="px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-white font-semibold text-base">{style.name}</p>
                    <p className="text-white/50 text-xs mt-0.5">{style.description}</p>
                  </div>
                  <span className="shrink-0 text-xs font-mono text-white/30 bg-white/5 px-2 py-1 rounded">
                    {style.id}
                  </span>
                </div>

                {/* FFmpeg string preview */}
                <details className="mt-3">
                  <summary className="text-white/30 text-xs cursor-pointer hover:text-white/60 transition-colors">
                    FFmpeg style string
                  </summary>
                  <pre className="mt-2 text-[10px] text-white/40 bg-black/40 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                    {style.ffmpeg(42, 110)}
                  </pre>
                </details>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-10 text-center text-white/30 text-xs">
          Styles are burned directly into the video using FFmpeg · Whisper provides word-level timing
        </p>
      </div>
    </main>
  )
}
