from pathlib import Path
import sys

import cv2


source = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(r"C:\Users\Administrator\Videos\NVIDIA\Desktop\Desktop 2026.10.07 - 21.50.06.01.mp4")
output = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parent / "video-reference-frames"
output.mkdir(exist_ok=True)

capture = cv2.VideoCapture(str(source))
print({"source": str(source), "exists": source.exists(), "size": source.stat().st_size if source.exists() else None, "opened": capture.isOpened()})
frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
fps = capture.get(cv2.CAP_PROP_FPS) or 30
duration = frame_count / fps if frame_count else 0

positions = [0.05, 0.25, 0.5, 0.75, 0.95]
written = []
for index, position in enumerate(positions, start=1):
    capture.set(cv2.CAP_PROP_POS_FRAMES, max(0, int((frame_count - 1) * position)))
    ok, frame = capture.read()
    if not ok:
        continue
    destination = output / f"frame-{index}.png"
    cv2.imwrite(str(destination), frame)
    written.append(str(destination))

capture.release()
print({"frames": frame_count, "fps": fps, "duration": duration, "written": written})
