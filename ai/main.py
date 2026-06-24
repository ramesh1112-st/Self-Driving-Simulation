import cv2
from ultralytics import YOLO
from decision import decide_action
import socketio
import base64

manual_command = None

# Connect backend
sio = socketio.Client()
sio.connect("http://localhost:5000")


# Receive manual commands
@sio.on("control_command")
def receive_command(cmd):
    global manual_command
    manual_command = cmd
    print("Manual command received:", cmd)


# Load YOLO model
model = YOLO("yolov8n.pt")

# Open camera
cap = cv2.VideoCapture(0)

if not cap.isOpened():
    print("Camera not found")
    exit()

while True:
    ret, frame = cap.read()

    if not ret:
        print("Failed to capture frame")
        break

    # Run YOLO
    results = model(frame)

    # Draw boxes
    annotated_frame = results[0].plot()

    # Resize for frontend
    annotated_frame = cv2.resize(annotated_frame, (640, 480))

    # Encode frame
    success, buffer = cv2.imencode(".jpg", annotated_frame)

    if not success:
        print("Encoding failed")
        continue

    # Convert to base64
    jpg_as_text = base64.b64encode(buffer).decode("utf-8")

    # Send video frame
    sio.emit("video_frame", "data:image/jpeg;base64," + jpg_as_text)

    print("Sending frame...")

    # Process detections
    for box in results[0].boxes:
        cls = int(box.cls[0])
        obj = model.names[cls]

        distance = 1.5

        if manual_command:
            action = manual_command
        else:
            action = decide_action(obj, distance)

        data = {
            "object": obj,
            "distance": f"{distance}m",
            "action": action,
            "status": "MOVING"
        }

        sio.emit("detection", data)

        print(data)

    # Local display
    cv2.imshow("Self Driving AI", annotated_frame)

    if cv2.waitKey(1) & 0xFF == ord("q"):
        break

cap.release()
cv2.destroyAllWindows()