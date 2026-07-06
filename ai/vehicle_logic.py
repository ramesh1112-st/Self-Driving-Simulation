def estimate_distance(box_width, known_width=50, focal_length=700):
    distance = (known_width * focal_length) / max(box_width, 1)
    return round(distance / 100, 2)
