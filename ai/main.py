import cv2
from ultralytics import YOLO
from detect import detect_objects
from decision import decide_action
import socketio

sio = socketio.Client()
sio.connect("http://localhost:5000")

data = {
    "object": "pedestrian",
    "distance": "1.2m",
    "action": "BRAKE"
}

sio.emit("detection", data)

print("Sent to backend")

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

    print("Phase 2 running...")

    # AI detection
    results = model(frame)

    # Draw boxes
    annotated_frame = results[0].plot()

    for box in results[0].boxes:
        cls = int(box.cls[0])
        obj = model.names[cls]

        #Fake distance for now
        distance = 1.5

        action = decide_action(obj, distance)

        print({
            "object" : obj,
            "distance" : f"{distance}m",
            "action" : action
        })

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
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

# Release resources
cap.release()
cv2.destroyAllWindows()