import cv2
from ultralytics import YOLO
from decision import decide_action
import socketio
import base64

# Default mode = AUTO
manual_command = "AUTO"

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

if not cap.isOpened():
    print("Camera not found")
    exit()


# Distance estimation function
def estimate_distance(box_width):
    KNOWN_WIDTH = 50      # cm
    FOCAL_LENGTH = 700    # camera calibration

    distance = (KNOWN_WIDTH * FOCAL_LENGTH) / max(box_width, 1)
    return round(distance / 100, 2)   # meters


while True:
    ret, frame = cap.read()

    if not ret:
        print("Failed to capture frame")
        break

    # Run YOLO detection
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

    # Send live video frame
    sio.emit("video_frame", "data:image/jpeg;base64," + jpg_as_text)

    print("Sending frame...")

    # Process detections
    for box in results[0].boxes:
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

        # Step 3 (GenAI explanation)
        from explainer import explain_decision

        explanation = explain_decision({
            "object": obj,
            "distance": distance,
            "action": action
        })

        print("AI Explanation:", explanation)

        sio.emit("ai_explanation", {
            "object": obj,
            "distance": distance,
            "action": action,
            "explanation": explanation
        })


        # Data to frontend
        data = {
            "object": obj,
            "distance": f"{distance}m",
            "action": action,
            "status": "STOPPED" if action in ["BRAKE", "STOP"] else "MOVING",
            "speed": 0 if action in ["BRAKE", "STOP"] else 20
        }

        # Send detection data
        sio.emit("detection", data)

        print(data)

    # Show local camera
    cv2.imshow("Self Driving AI", annotated_frame)

    if cv2.waitKey(1) & 0xFF == ord("q"):
        break

cap.release()
cv2.destroyAllWindows()