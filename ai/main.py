import time
import cv2
from ultralytics import YOLO
from decision import decide_action
import socketio
import base64
from explainer import explain_decision
from concurrent.futures import ThreadPoolExecutor
from vehicle_logic import estimate_distance

# Default mode = AUTO
manual_command = "AUTO"
FRAME_SEND_INTERVAL = 0.066  # send approximately 15 frames per second
DETECTION_SEND_INTERVAL = 0.1
JPEG_QUALITY = 45
CAPTURE_SIZE = (480, 360)
DETECT_SIZE = 320
last_frame_sent_at = 0.0
last_detection_sent_at = 0.0
last_explanation_signature = None
pending_explanation_signature = None
executor = ThreadPoolExecutor(max_workers=1)

# Connect backend
sio = socketio.Client()
sio.connect("http://localhost:5000")


# Receive manual commands from frontend
@sio.on("control_command")
def receive_command(cmd):
    global manual_command
    manual_command = cmd
    print("Manual command received:", cmd)


# Load YOLO model
model = YOLO("yolov8n.pt")

# Open camera
cap = cv2.VideoCapture(0)
cap.set(cv2.CAP_PROP_FRAME_WIDTH, CAPTURE_SIZE[0])
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAPTURE_SIZE[1])
cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

if not cap.isOpened():
    print("Camera not found")
    exit()


while True:
    ret, frame = cap.read()

    if not ret:
        print("Failed to capture frame")
        break

    # Reduce resolution before detection to improve latency
    frame = cv2.resize(frame, CAPTURE_SIZE)

    # Run YOLO detection
    results = model.predict(frame, imgsz=DETECT_SIZE, verbose=False)

    # Draw boxes
    annotated_frame = results[0].plot()

    now = time.time()

    # Send video frames at a controlled rate
    if now - last_frame_sent_at >= FRAME_SEND_INTERVAL:
        success, buffer = cv2.imencode(
            ".jpg",
            annotated_frame,
            [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY],
        )

        if success:
            jpg_as_text = base64.b64encode(buffer).decode("utf-8")
            sio.emit("video_frame", "data:image/jpeg;base64," + jpg_as_text)
            last_frame_sent_at = now
        else:
            print("Encoding failed")

    # Only handle the top detection per frame to avoid repeated explanation calls
    if len(results[0].boxes) == 0:
        continue

    box = results[0].boxes[0]
    cls = int(box.cls[0])
    obj = model.names[cls]

    # Bounding box
    x1, y1, x2, y2 = map(int, box.xyxy[0])

    # Box width for distance estimation
    box_width = x2 - x1

    # Estimate distance
    distance = estimate_distance(box_width)

    # Decide action
    if manual_command == "AUTO":
        action = decide_action(obj, distance)
    else:
        action = manual_command

    explanation_key = f"{obj}|{distance}|{action}"
    if (
        explanation_key != last_explanation_signature
        and explanation_key != pending_explanation_signature
    ):
        pending_explanation_signature = explanation_key
        explanation_payload = {
            "object": obj,
            "distance": distance,
            "action": action,
        }

        def explain_and_emit(signature, payload):
            global last_explanation_signature, pending_explanation_signature

            explanation = explain_decision(payload)
            last_explanation_signature = signature
            pending_explanation_signature = None

            print("AI Explanation:", explanation)

            sio.emit("ai_explanation", {
                "object": payload["object"],
                "distance": payload["distance"],
                "action": payload["action"],
                "explanation": explanation,
            })

        executor.submit(explain_and_emit, explanation_key, explanation_payload)

    # Data to frontend
    data = {
        "object": obj,
        "distance": f"{distance}m",
        "action": action,
        "status": "STOPPED" if action in ["BRAKE", "STOP"] else "MOVING",
        "speed": 0 if action in ["BRAKE", "STOP"] else 20,
    }

    # Send detection data at a controlled rate so UI state updates do not lag video.
    if now - last_detection_sent_at >= DETECTION_SEND_INTERVAL:
        sio.emit("detection", data)
        last_detection_sent_at = now
        print(data)

    # Show local camera
    cv2.imshow("Self Driving AI", annotated_frame)

    if cv2.waitKey(1) & 0xFF == ord("q"):
        break

cap.release()
cv2.destroyAllWindows()
