from flask import Flask, request, jsonify
from flask_cors import CORS
from ultralytics import YOLO
from PIL import Image

app = Flask(__name__)
CORS(app)

# REAL AI Model - pehli baar download hoga
model = YOLO('yolov8n.pt')

@app.route('/')
def home():
    return jsonify({"status": "SecureAssistant AI - 100% REAL - LIVE"})

@app.route('/detect', methods=['POST'])
def detect():
    if 'image' not in request.files:
        return jsonify({"error": "no image"}), 400

    file = request.files['image']
    img = Image.open(file.stream).convert("RGB")
    results = model(img)

    detections = []
    for r in results:
        for box in r.boxes:
            name = model.names[int(box.cls[0])]
            conf = float(box.conf[0])
            if conf > 0.4:
                detections.append({
                    "label": name,
                    "confidence": round(conf, 2)
                })

    return jsonify({
        "is_real": True,
        "detections": detections,
        "count": len(detections)
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=10000)