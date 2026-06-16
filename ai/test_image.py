from ultralytics import YOLO
import cv2

# Load model
model = YOLO("yolov8n.pt")

# Read image
image = cv2.imread("test.jpg")

# Detect
results = model(image)

# Show output
annotated = results[0].plot()

cv2.imshow("Detection Test", annotated)
cv2.waitKey(0)
cv2.destroyAllWindows()