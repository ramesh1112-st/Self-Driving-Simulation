import cv2
from ultralytics import YOLO
from decision import decide_action
import socketio
import base64

# Connect to backend
sio = socketio.Client()
sio.connect("http://localhost:5000")

# Load YOLO model
model = YOLO("yolov8n.pt")

# Open webcam
cap = cv2.VideoCapture(0)

# Check camera
if not cap.isOpened():
    print("Camera not found")
    exit()

while True:
    # Read frame
    ret, frame = cap.read()

    if not ret:
        print("Failed to capture frame")
        break

    print("Phase 4 running...")

    # AI detection
    results = model(frame)

    # Draw bounding boxes
    annotated_frame = results[0].plot()

    # Convert frame to jpg
    _, buffer = cv2.imencode(".jpg", annotated_frame)

    # Convert jpg to base64
    jpg_as_text = base64.b64encode(buffer.tobytes()).decode("utf-8")
    
    # Send live video frame to backend
    sio.emit("video_frame", f"data:image/jpeg;base64,{jpg_as_text}")
    print("Frame sent")

    # Process detections
    for box in results[0].boxes:
        cls = int(box.cls[0])
        obj = model.names[cls]

        # Fake distance for now
        distance = 1.5

        # Decision making
        action = decide_action(obj, distance)

        data = {
            "object": obj,
            "distance": f"{distance}m",
            "action": action,
            "status": "MOVING"
        }

        # Send detection data to backend
        sio.emit("detection", data)

        print("Sent to backend")
        print(data)

        # Show action on screen
        cv2.putText(
            annotated_frame,
            f"{obj} -> {action}",
            (20, 40),
            cv2.FONT_HERSHEY_SIMPLEX,
            1,
            (0, 255, 0),
            2
        )

    # Show screen
    cv2.imshow("Self Driving AI", annotated_frame)

    # Press q to exit
    if cv2.waitKey(1) & 0xFF == ord("q"):
        break

# Release resources
cap.release()
cv2.destroyAllWindows()