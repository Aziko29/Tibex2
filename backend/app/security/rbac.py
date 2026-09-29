def has_permission(role_permissions, module: str, action: str) -> bool:
    """Rol ruxsatlari ro'yxatida `module.action` borligini tekshiradi."""
    if role_permissions == "*":
        return True
    if not isinstance(role_permissions, list):
        return False
    return f"{module}.{action}" in role_permissions
