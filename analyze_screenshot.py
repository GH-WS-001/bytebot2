import cv2
import numpy as np
import json

# Load the screenshot
image = cv2.imread('/Users/weisong/Downloads/bytebot-main 2/screenshot_final.png')
height, width, _ = image.shape
print(f"Image size: {width}x{height}")

# Convert to HSV for color analysis
hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)

# Define range of blue colors (common for buttons)
lower_blue = np.array([100, 50, 50])
upper_blue = np.array([130, 255, 255])

# Threshold the HSV image to get blue components
mask = cv2.inRange(hsv, lower_blue, upper_blue)
result = cv2.bitwise_and(image, image, mask=mask)

# Find contours
contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

print(f"\nFound {len(contours)} potential button regions:")

# Store button candidates
button_candidates = []

for i, contour in enumerate(contours):
    area = cv2.contourArea(contour)
    if area > 1000:  # Filter small regions
        x, y, w, h = cv2.boundingRect(contour)
        button_candidates.append({import cv2
import numpy as np
import 'import nu  import json

# Lo  
# Lo    'widimage = cv2.imread(''hheight, width, _ = image.shape
print(f"Image size: {width}x{height}")

# Convert   print(f"Image size: {width}x{  
# Convert to HSV for color anal x={x}, hsv = cv2.cvtColor(image, cv2.COLO


# Define range of blue colors ( = {
    'imaglower_blue = np.array([100, 50, 50])
upper_blue ='buppen_candidates': button_candidates

# Threshold the HSV image to get blun',mask = cv2.inRange(hsv, lower_blue, upper_blue))
result = cv2.bitwise_and(image, image, mask=mais
# Find contours
contours, _ = cv2.findContours(a:"contours, _ = or
print(f"\nFound {len(contours)} potential button regions:")

# Store button ca  -
# Store button candidates
button_candidates = []

for i}x{btbutton_candidates er: ({bt
for i, contour in en'center_y']})")
