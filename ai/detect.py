from ultralytics import YOLO
import cv2

model = YOLO("yolov8n.pt")

def detect_objects(frame):
    results = model(frame)

    detections = []

    for r in results:
        for box in r.boxes:
            cls = int(box.cls[0])
            name = model.names[cls]

            x1, y1, x2, y2 = map(int, box.xyxy[0])

            detections.append({
                "object": name,
                "box": [x1, y1, x2, y2]
            })

    return detections