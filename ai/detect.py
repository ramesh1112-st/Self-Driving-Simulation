from ultralytics import YOLO
import cv2
import socketio

model = YOLO("yolov8n.pt")

# Connect to backend
sio = socketio.Client()
sio.connect("http://localhost:5000")


def detect_objects(frame):
    results = model(frame)

    detections = []

    for r in results:
        for box in r.boxes:
            cls = int(box.cls[0])
            name = model.names[cls]

            x1, y1, x2, y2 = map(int, box.xyxy[0])

            # Decision logic
            action = "MOVE"

            if name == "person":
                action = "BRAKE"
            elif name == "car":
                action = "STOP"

            detection_data = {
                "object": name,
                "box": [x1, y1, x2, y2],
                "action": action,
                "distance": "1.2m",
                "status": "MOVING"
            }

            detections.append(detection_data)

            # Send to backend
            sio.emit("detection", detection_data)

    return detections, results