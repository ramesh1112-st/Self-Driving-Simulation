import cv2
from ultralytics import YOLO
from decision import decide_action
import socketio
import base64

manual_command = None

# Connect backend
sio = socketio.Client()
sio.connect("http://localhost:5000")


# Listen for manual commands (OUTSIDE LOOP)
@sio.on("control_command")
def receive_command(cmd):
    global manual_command
    manual_command = cmd
    print("Manual command received:", cmd)


# Load model
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

    results = model(frame)

    annotated_frame = results[0].plot()

    # Send video frame
    _, buffer = cv2.imencode(".jpg", annotated_frame)
    jpg_as_text = base64.b64encode(buffer.tobytes()).decode("utf-8")

    sio.emit("video_frame", f"data:image/jpeg;base64,{jpg_as_text}")

    # Process detections
    for box in results[0].boxes:
        cls = int(box.cls[0])
        obj = model.names[cls]

        distance = 1.5

        # Manual override
        if manual_command:
            action = manual_command
        else:
            action = decide_action(obj)

        data = {
            "object": obj,
            "distance": f"{distance}m",
            "action": action,
            "status": "MOVING"
        }

        sio.emit("detection", data)

        print(data)

        cv2.putText(
            annotated_frame,
            f"{obj} -> {action}",
            (20, 40),
            cv2.FONT_HERSHEY_SIMPLEX,
            1,
            (0, 255, 0),
            2
        )

    cv2.imshow("Self Driving AI", annotated_frame)

    if cv2.waitKey(1) & 0xFF == ord("q"):
        break

cap.release()
cv2.destroyAllWindows()