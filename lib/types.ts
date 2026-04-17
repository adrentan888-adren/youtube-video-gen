export interface Segment {
  segmentIndex: number
  segmentNumber: number
  sectionTitle: string
  narration: string
  imagePrompt: string
}

export interface Script {
  title: string
  description: string
  fullNarration: string
  segments: Segment[]
}

export interface ImageTask {
  segmentIndex: number
  taskId: string
}

export interface ImageResult {
  segmentIndex: number
  imageUrl: string
}
