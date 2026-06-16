def decide_action(object_name, distance):

    if object_name == "person":
        if distance < 2:
            return "BRAKE"

    elif object_name == "car":
        if distance < 3:
            return "STOP"

    elif object_name == "bicycle":
        if distance < 2:
            return "SLOW"

    return "MOVE"