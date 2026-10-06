# Secure Assistant AI service (Flask + YOLOv8n)
# Detects 80 common objects (person, car, bag, etc.) in photos and videos.
# It does NOT do face recognition, number plates, fire or weapon detection yet.
import hmac
import os
import tempfile

import cv2
from flask import Flask, jsonify, request
from PIL import Image
from ultralytics import YOLO

app = Flask(__name__)

def env_num(name, default, cast=float):
    """Read a number from an environment variable; fall back to the default if missing or invalid."""
    try:
        return cast(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default

# Everything below can be tuned in Render's environment without touching the code.
app.config["MAX_CONTENT_LENGTH"] = env_num("MAX_UPLOAD_MB", 25, int) * 1024 * 1024
SECRET = os.environ.get("PYTHON_SECRET", "")
MIN_CONF = env_num("MIN_CONFIDENCE", 0.4)          # ignore detections below this confidence (0 to 1)
MAX_FRAMES = env_num("MAX_VIDEO_FRAMES", 8, int)   # how many frames are sampled from a video
VIDEO_EXT = (".mp4", ".mov", ".avi", ".mkv", ".webm", ".3gp")

model = YOLO(os.environ.get("YOLO_MODEL", "yolov8n.pt"))  # downloads on first start if the file is not present


def authorized():
    if not SECRET:  # refuse everything if the secret is not configured
        return False
    return hmac.compare_digest(request.headers.get("X-CORE-SECRET", ""), SECRET)


def detect_image(img):
    found = []
    for r in model(img, verbose=False):
        for box in r.boxes:
            conf = float(box.conf[0])
            if conf >= MIN_CONF:
                found.append({"label": model.names[int(box.cls[0])], "confidence": round(conf, 2)})
    return found


def detect_video(path):
    cap = cv2.VideoCapture(path)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    if total <= 0:
        cap.release()
        return None, 0
    step = max(1, total // MAX_FRAMES)
    best = {}
    analyzed = 0
    for idx in range(0, total, step):
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ok, frame = cap.read()
        if not ok:
            continue
        analyzed += 1
        img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        for d in detect_image(img):
            cur = best.setdefault(d["label"], {"label": d["label"], "confidence": 0, "frames_seen": 0})
            cur["confidence"] = max(cur["confidence"], d["confidence"])
            cur["frames_seen"] += 1
    cap.release()
    return list(best.values()), analyzed


@app.route("/")
def home():
    return jsonify({"status": "SecureAssistant AI live", "model": "yolov8n (80 COCO objects)"})


@app.route("/detect", methods=["POST"])
def detect():
    if not authorized():
        return jsonify({"error": "unauthorized"}), 401
    f = request.files.get("file") or request.files.get("image")
    if f is None:
        return jsonify({"error": "no file"}), 400
    name = (f.filename or "").lower()
    meta = {"categoryId": request.form.get("categoryId"), "uid": request.form.get("uid")}
    try:
        if name.endswith(VIDEO_EXT) or (f.mimetype or "").startswith("video/"):
            suffix = os.path.splitext(name)[1] or ".mp4"
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as tmp:
                f.save(tmp.name)
                detections, analyzed = detect_video(tmp.name)
            if detections is None:
                return jsonify({"error": "could not read video"}), 400
            return jsonify({"type": "video", "framesAnalyzed": analyzed, "detections": detections, "count": len(detections), **meta})
        img = Image.open(f.stream).convert("RGB")
        detections = detect_image(img)
        return jsonify({"type": "image", "detections": detections, "count": len(detections), **meta})
    except Exception as e:  # unreadable or unsupported file
        app.logger.exception("detect failed")
        return jsonify({"error": "could not process file"}), 400


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 10000)))