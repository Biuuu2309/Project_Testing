POINT_OVERRIDES = {"CHAT_HEO_DO": 10}


def effective_base_points(action_type) -> int:
    return POINT_OVERRIDES.get(action_type.code, action_type.base_points)
