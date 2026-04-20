export interface SubtitleStyle {
  id: string
  name: string
  description: string
  /** Returns the FFmpeg force_style string for a given fontSize and marginV */
  ffmpeg: (fontSize: number, marginV: number) => string
  /** CSS properties to simulate the style in the browser catalog */
  css: {
    color: string
    fontWeight: string
    background?: string
    WebkitTextStroke?: string
    textShadow?: string
    padding?: string
    borderRadius?: string
  }
  position: 'bottom' | 'top'
}

export const SUBTITLE_STYLES: SubtitleStyle[] = [
  {
    id: 'karaoke-pop',
    name: 'Karaoke Pop ✦',
    description: 'Full line visible; active word pops orange+larger in real time — word-level sync from Whisper',
    ffmpeg: (fs, mv) =>
      `FontName=Liberation Sans,FontSize=${fs},Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&HAA000000,BorderStyle=3,Outline=10,Alignment=2,MarginV=${mv}`,
    css: {
      color: 'white',
      fontWeight: '700',
      background: 'rgba(0,0,0,0.65)',
      padding: '6px 14px',
      borderRadius: '4px',
    },
    position: 'bottom',
  },
  {
    id: 'tiktok-box',
    name: 'TikTok Box',
    description: 'Bold white text on a semi-transparent dark box — default viral style',
    ffmpeg: (fs, mv) =>
      `FontName=Liberation Sans,FontSize=${fs},Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H99000000,BorderStyle=3,Outline=12,Alignment=2,MarginV=${mv}`,
    css: {
      color: 'white',
      fontWeight: '700',
      background: 'rgba(0,0,0,0.6)',
      padding: '6px 14px',
      borderRadius: '4px',
    },
    position: 'bottom',
  },
  {
    id: 'youtube-classic',
    name: 'YouTube Classic',
    description: 'White text with black outline and drop shadow, no box',
    ffmpeg: (fs, mv) =>
      `FontName=Liberation Sans,FontSize=${fs},Bold=0,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=${mv}`,
    css: {
      color: 'white',
      fontWeight: '400',
      textShadow: '-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, 3px 3px 4px rgba(0,0,0,0.8)',
    },
    position: 'bottom',
  },
  {
    id: 'netflix',
    name: 'Netflix',
    description: 'White text on a solid black bar — maximum readability',
    ffmpeg: (fs, mv) =>
      `FontName=Liberation Sans,FontSize=${fs},Bold=0,PrimaryColour=&H00FFFFFF,BackColour=&HFF000000,BorderStyle=3,Outline=8,Alignment=2,MarginV=${mv}`,
    css: {
      color: 'white',
      fontWeight: '400',
      background: 'rgba(0,0,0,1)',
      padding: '4px 12px',
      borderRadius: '2px',
    },
    position: 'bottom',
  },
  {
    id: 'bold-yellow',
    name: 'Bold Yellow',
    description: 'High-contrast bold yellow text with thick black outline',
    ffmpeg: (fs, mv) =>
      `FontName=Liberation Sans,FontSize=${fs},Bold=1,PrimaryColour=&H0000FFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=3,Shadow=0,Alignment=2,MarginV=${mv}`,
    css: {
      color: '#FFFF00',
      fontWeight: '700',
      WebkitTextStroke: '2px black',
      textShadow: '-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000',
    },
    position: 'bottom',
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Clean white text with a subtle outline — no background',
    ffmpeg: (fs, mv) =>
      `FontName=Liberation Sans,FontSize=${fs},Bold=0,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=1,Outline=1,Shadow=0,Alignment=2,MarginV=${mv}`,
    css: {
      color: 'white',
      fontWeight: '400',
      textShadow: '-1px -1px 0 rgba(0,0,0,0.5), 1px -1px 0 rgba(0,0,0,0.5), -1px 1px 0 rgba(0,0,0,0.5), 1px 1px 0 rgba(0,0,0,0.5)',
    },
    position: 'bottom',
  },
  {
    id: 'top-box',
    name: 'Top Box',
    description: 'TikTok-style box but positioned at the top of the screen',
    ffmpeg: (fs, _mv) =>
      `FontName=Liberation Sans,FontSize=${fs},Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H99000000,BorderStyle=3,Outline=12,Alignment=8,MarginV=60`,
    css: {
      color: 'white',
      fontWeight: '700',
      background: 'rgba(0,0,0,0.6)',
      padding: '6px 14px',
      borderRadius: '4px',
    },
    position: 'top',
  },
]

export function getStyle(id: string): SubtitleStyle {
  return SUBTITLE_STYLES.find((s) => s.id === id) ?? SUBTITLE_STYLES[0]
}
