#!/usr/bin/env python3
"""
Generate TTS audio using edge-tts (Microsoft Neural TTS, free, no API key).
Usage: python3 tts.py "text to speak" /output/path.mp3 [voice]
"""
import sys
import asyncio
import edge_tts

async def main():
    text = sys.argv[1]
    output_path = sys.argv[2]
    voice = sys.argv[3] if len(sys.argv) > 3 else 'en-US-JennyNeural'

    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(output_path)

asyncio.run(main())
