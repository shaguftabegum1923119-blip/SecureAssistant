from flask import Flask, request, jsonify
from flask_cors import CORS
import torch
import torch.nn.modules.container
from torch.nn.modules.container import Sequential, ModuleList, ModuleDict
from ultralytics import YOLO
from PIL import Image
import os

# --- FIX START: Ye 8 line maine ADD ki hai, bina kuch delete kiye ---
# PyTorch 2.6 ko batana ki Sequential safe hai - Purane version ke liye safe check
if hasattr(torch.serialization, 'add_safe_globals'):
    torch.serialization.add_safe_globals([
        torch.nn.modules.container.Sequential,
        Sequential,
        ModuleList,
        ModuleDict
    ])
    try:
        from ultralytics.nn.tasks import DetectionModel
        from ultralytics.nn.modules import Conv, Bottleneck, C2f, SPPF, Detect
        torch.serialization.add_safe_globals([DetectionModel, Conv, Bottleneck, C2f, SPPF, Detect])
    except Exception:
        pass
# --- FIX END ---

app = Flask(__name__)
CORS(app)

# Load YOLO Model
print("Loading YOLO Model...")
model = YOLO('yolov8n.pt')
print("Model Loaded Successfully!")

@app.route('/')
def home():
    return jsonify({
        "status": "SecureAssistant AI - 100% REAL - LIVE",
        "is_real": True
    })

@app.route('/detect', methods=['POST'])
def detect():
    if 'image' not in request.files:
        return jsonify({"error": "no image provided"}), 400

    try:
        file = request.files['image']
        img = Image.open(file.stream).convert("RGB")
        results = model(img)

        detections = []
        for r in results:
            for box in r.boxes:
                label = model.names[int(box.cls[0])]
                confidence = float(box.conf[0])
                if confidence > 0.4:
                    detections.append({
                        "label": label,
                        "confidence": round(confidence, 2)
                    })

        return jsonify({
            "is_real": True,
            "detections": detections,
            "count": len(detections)
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 10000))
    app.run(host='0.0.0.0', port=port)