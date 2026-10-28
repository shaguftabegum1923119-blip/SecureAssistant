# Secure Assistant AI service (Flask + YOLOv8n + face templates)
# Detects 80 common objects (person, car, bag, etc.) in photos and videos.
# Face templates (OpenCV YuNet + SFace) are made only for people added with their consent.
# It does NOT do number plates, fire or weapon detection yet.
import hmac
import os
import tempfile
import threading
import time

import cv2
import numpy as np
from flask import Flask, jsonify, request
from PIL import Image
from ultralytics import YOLO

app = Flask(__name__)
HERE = os.path.dirname(os.path.abspath(__file__))


def log(msg):
    print("[ai] " + str(msg), flush=True)


def env_num(name, default, cast=float):
    """Read a number from an environment variable; fall back to the default if missing or invalid."""
    try:
        return cast(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


app.config["MAX_CONTENT_LENGTH"] = env_num("MAX_UPLOAD_MB", 25, int) * 1024 * 1024
SECRET = os.environ.get("PYTHON_SECRET", "")
MIN_CONF = env_num("MIN_CONFIDENCE", 0.3)
MAX_FRAMES = env_num("MAX_VIDEO_FRAMES", 8, int)
IMG_SIZE = env_num("YOLO_IMG_SIZE", 320, int)
VIDEO_EXT = (".mp4", ".mov", ".avi", ".mkv", ".webm", ".3gp")

FACE_DET_PATH = os.environ.get("FACE_DET_MODEL") or os.path.join(HERE, "face_detection_yunet_2023mar.onnx")
FACE_REC_PATH = os.environ.get("FACE_REC_MODEL") or os.path.join(HERE, "face_recognition_sface_2021dec.onnx")
FACE_DET_SCORE = env_num("FACE_DET_SCORE", 0.85)
FACE_MAX_FACES = env_num("FACE_MAX_FACES", 5, int)

_model = None
_model_error = None
_model_state = "not started"
_model_lock = threading.Lock()

_face = {"det": None, "rec": None}
_face_error = None
_face_state = "not loaded"
_face_lock = threading.Lock()
_face_run_lock = threading.Lock()


def model_path():
    custom = os.environ.get("YOLO_MODEL")
    if custom:
        return custom
    here = os.path.join(HERE, "yolov8n.pt")
    return here if os.path.exists(here) else "yolov8n.pt"


def get_model():
    global _model, _model_error, _model_state
    if _model is not None:
        return _model
    with _model_lock:
        if _model is None:
            started = time.time()
            path = model_path()
            _model_state = "loading"
            log("loading model from " + path)
            try:
                _model = YOLO(path)
                _model_error = None
                _model_state = "loaded"
                log("model loaded in %.1f sec" % (time.time() - started))
            except BaseException as e:
                _model_error = (type(e).__name__ + ": " + str(e))[:200]
                _model_state = "failed"
                log("model load FAILED: " + _model_error)
                raise
    return _model


def get_face_models():
    global _face_error, _face_state
    if _face["det"] is not None and _face["rec"] is not None:
        return _face["det"], _face["rec"]
    with _face_lock:
        if _face["det"] is None or _face["rec"] is None:
            try:
                for path, minimum in ((FACE_DET_PATH, 100000), (FACE_REC_PATH, 1000000)):
                    if not os.path.exists(path) or os.path.getsize(path) < minimum:
                        raise RuntimeError("face model file missing or incomplete: " + os.path.basename(path))
                _face["det"] = cv2.FaceDetectorYN.create(FACE_DET_PATH, "", (320, 320), FACE_DET_SCORE, 0.3, 5000)
                _face["rec"] = cv2.FaceRecognizerSF.create(FACE_REC_PATH, "")
                _face_error = None
                _face_state = "ready"
                log("face models loaded")
            except BaseException as e:
                _face_error = (type(e).__name__ + ": " + str(e))[:200]
                _face_state = "failed"
                log("face model load FAILED: " + _face_error)
                raise
    return _face["det"], _face["rec"]


def _warm_up():
    log("warm-up thread started (process " + str(os.getpid()) + ")")
    try:
        get_model()
    except BaseException:
        log("warm-up ended with an error")
    try:
        get_face_models()
    except BaseException:
        log("face warm-up ended with an error")


def _reset_after_fork():
    # The server may load this file once and then copy it into the worker process.
    # A copied loader thread and lock do not work, so the worker starts its own clean load.
    global _model, _model_error, _model_state, _model_lock, _face_lock, _face_run_lock
    _model = None
    _model_error = None
    _model_state = "not started"
    _model_lock = threading.Lock()
    _face_lock = threading.Lock()
    _face_run_lock = threading.Lock()
    threading.Thread(target=_warm_up, daemon=True).start()


if hasattr(os, "register_at_fork"):
    os.register_at_fork(after_in_child=_reset_after_fork)

threading.Thread(target=_warm_up, daemon=True).start()


def authorized():
    if not SECRET:
        return False
    return hmac.compare_digest(request.headers.get("X-CORE-SECRET", ""), SECRET)


def detect_image(img):
    found = []
    model = get_model()
    for r in model(img, verbose=False, imgsz=IMG_SIZE):
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


def face_embeddings(bgr):
    """Returns up to FACE_MAX_FACES faces (largest first), each with a unit-length 128-number template."""
    det, rec = get_face_models()
    h, w = bgr.shape[:2]
    scale = min(1.0, 640.0 / max(h, w))
    if scale < 1.0:
        bgr = cv2.resize(bgr, (max(1, int(w * scale)), max(1, int(h * scale))))
        h, w = bgr.shape[:2]
    out = []
    with _face_run_lock:
        det.setInputSize((w, h))
        _, faces = det.detect(bgr)
        if faces is None or len(faces) == 0:
            return out
        order = np.argsort(-(faces[:, 2] * faces[:, 3]))[:FACE_MAX_FACES]
        for i in order:
            row = faces[i]
            feat = rec.feature(rec.alignCrop(bgr, row)).flatten().astype(np.float64)
            norm = float(np.linalg.norm(feat))
            if norm == 0:
                continue
            out.append({
                "embedding": [round(float(v), 6) for v in (feat / norm)],
                "box": [round(float(row[0]) / w, 3), round(float(row[1]) / h, 3),
                        round(float(row[2]) / w, 3), round(float(row[3]) / h, 3)],
                "detScore": round(float(row[14]), 3)
            })
    return out


@app.route("/")
@app.route("/health")
def home():
    return jsonify({"status": "SecureAssistant AI live", "model": "yolov8n (80 COCO objects, lightweight mode)",
                    "modelLoaded": _model is not None, "modelState": _model_state, "modelError": _model_error,
                    "faceModels": _face_state, "faceError": _face_error})


@app.route("/detect", methods=["POST"])
def detect():
    if not authorized():
        return jsonify({"error": "unauthorized"}), 401
    f = request.files.get("file") or request.files.get("image")
    if f is None:
        return jsonify({"error": "no file"}), 400
    try:
        get_model()
    except Exception:
        return jsonify({"error": "model not ready, try again in a minute"}), 503
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
            return jsonify({"type": "video", "framesAnalyzed": analyzed,
                            "detections": detections, "count": len(detections), **meta})
        img = Image.open(f.stream).convert("RGB")
        detections = detect_image(img)
        return jsonify({"type": "image", "detections": detections, "count": len(detections), **meta})
    except Exception as e:
        app.logger.exception("detect failed")
        return jsonify({"error": "could not process file"}), 400


@app.route("/face/embed", methods=["POST"])
def face_embed():
    if not authorized():
        return jsonify({"error": "unauthorized"}), 401
    f = request.files.get("file") or request.files.get("image")
    if f is None:
        return jsonify({"error": "no file"}), 400
    try:
        get_face_models()
    except Exception:
        return jsonify({"error": "face models not ready"}), 503
    img = cv2.imdecode(np.frombuffer(f.read(), dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return jsonify({"error": "could not read the photo"}), 400
    try:
        faces = face_embeddings(img)
    except Exception:
        app.logger.exception("face embed failed")
        return jsonify({"error": "could not process the photo"}), 400
    return jsonify({"count": len(faces), "faces": faces})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 10000)))