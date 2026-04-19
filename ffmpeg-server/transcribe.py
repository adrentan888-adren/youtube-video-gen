#!/usr/bin/env python3
import sys, json
from faster_whisper import WhisperModel

audio_path = sys.argv[1]
model = WhisperModel("tiny", device="cpu", compute_type="int8")
segments, _ = model.transcribe(audio_path, word_timestamps=True, language="en")

words = []
for seg in segments:
    if seg.words:
        for w in seg.words:
            words.append({"word": w.word.strip(), "start": float(w.start), "end": float(w.end)})

print(json.dumps(words))
