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
        is_lion_found = False # --- YE MAINE ADD KIYA HAI LION KE LIYE ---

        for r in results:
            for box in r.boxes:
                label = model.names[int(box.cls[0])]
                confidence = float(box.conf[0])
                if confidence > 0.4:
                    detections.append({
                        "label": label,
                        "confidence": round(confidence, 2)
                    })
                    # --- YE MAINE ADD KIYA HAI - LION CHECK ---
                    # Kyunki yolov8n me lion nahi hai, wo lion ko cat/dog/bear batata hai
                    # To hum usko bhi lion samjhenge
                    if label in ['cat', 'dog', 'bear', 'lion']:
                        is_lion_found = True

        return jsonify({
            "is_real": True,
            "detections": detections,
            "count": len(detections),
            "is_lion_present": is_lion_found, # --- YE MAINE ADD KIYA HAI ---
            "lion_message": "Lion mil gaya!" if is_lion_found else "Lion nahi hai is image me" # --- YE MAINE ADD KIYA HAI ---
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 10000))
    app.run(host='0.0.0.0', port=port)